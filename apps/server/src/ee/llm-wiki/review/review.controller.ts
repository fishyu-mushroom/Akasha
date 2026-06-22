import {
  Body,
  Controller,
  ForbiddenException,
  HttpCode,
  HttpStatus,
  Inject,
  Post,
  UseGuards,
} from '@nestjs/common';
import { User, Workspace } from '@docmost/db/types/entity.types';
import { KnowledgeCapsuleRepo } from '@docmost/db/repos/llm-wiki/knowledge-capsule.repo';
import { AuthUser } from '../../../common/decorators/auth-user.decorator';
import { AuthWorkspace } from '../../../common/decorators/auth-workspace.decorator';
import { AuditEvent, AuditResource } from '../../../common/events/audit-events';
import { JwtAuthGuard } from '../../../common/guards/jwt-auth.guard';
import { UserRole } from '../../../common/helpers/types/permission';
import {
  AUDIT_SERVICE,
  IAuditService,
} from '../../../integrations/audit/audit.service';
import { isKnowledgeAiEnabledForWorkspace } from '../services/ai-knowledge-chat.service';
import { ReviewService } from './review.service';
import { KnowledgeArtifactWikiSource } from './knowledge-artifact-wiki-source';
import { MockSearchProvider } from './search-provider';
import { isDeepSearch, isSkip, ResolvedReview } from './approval';
import { reviewItemSchema } from './review.schema';
import { DiscoverReviewDto } from './dto/discover-review.dto';
import { LoadReviewDto } from './dto/load-review.dto';
import { NegotiateReviewDto } from './dto/negotiate-review.dto';
import { ReviewApplyService } from './review-apply.service';
import { ReviewSnapshotService } from './review-snapshot.service';

@UseGuards(JwtAuthGuard)
@Controller('llm-wiki/review')
export class ReviewController {
  constructor(
    private readonly reviewService: ReviewService,
    private readonly applyService: ReviewApplyService,
    private readonly snapshotService: ReviewSnapshotService,
    private readonly capsuleRepo: KnowledgeCapsuleRepo,
    @Inject(AUDIT_SERVICE) private readonly auditService: IAuditService,
  ) {}

  @HttpCode(HttpStatus.OK)
  @Post('load')
  async load(
    @Body() dto: LoadReviewDto,
    @AuthUser() user: User,
    @AuthWorkspace() workspace: Workspace,
  ) {
    this.assertAiEnabled(workspace);
    this.assertAdmin(user);

    return this.snapshotService.loadSnapshot({
      workspaceId: workspace.id,
      spaceId: dto.spaceId,
    });
  }

  @HttpCode(HttpStatus.OK)
  @Post('discover')
  async discover(
    @Body() dto: DiscoverReviewDto,
    @AuthUser() user: User,
    @AuthWorkspace() workspace: Workspace,
  ) {
    this.assertAiEnabled(workspace);
    this.assertAdmin(user);

    const source = this.buildSource(workspace.id, dto.spaceId, dto.limit);
    const result = await this.reviewService.reviewWiki(source);
    const docs = await source.getDocMeta();
    const snapshot = await this.snapshotService.replaceDiscoveredSnapshot({
      workspaceId: workspace.id,
      spaceId: dto.spaceId,
      items: result.items,
      docs,
    });
    this.auditService.log({
      event: AuditEvent.KNOWLEDGE_REVIEW_DISCOVERED,
      resourceType: AuditResource.KNOWLEDGE,
      resourceId: dto.spaceId,
      spaceId: dto.spaceId,
      metadata: {
        limit: dto.limit ?? null,
        documentCount: docs.length,
        reviewItemCount: result.items.length,
        reviewItemTypes: countReviewItemTypes(result.items),
      },
    });
    return snapshot;
  }

  @HttpCode(HttpStatus.OK)
  @Post('negotiate')
  async negotiate(
    @Body() dto: NegotiateReviewDto,
    @AuthUser() user: User,
    @AuthWorkspace() workspace: Workspace,
  ): Promise<ResolvedReview> {
    this.assertAiEnabled(workspace);
    this.assertAdmin(user);

    const item = reviewItemSchema.parse(dto.item);
    const feedback = (dto.feedback ?? '').trim();
    const docSource = this.buildSource(workspace.id, dto.spaceId);

    if (isSkip(feedback)) {
      const resolved: ResolvedReview = {
        item,
        feedback,
        skipped: true,
        deepSearched: false,
        searchResults: [],
        draft: null,
        applied: null,
      };
      await this.snapshotService.saveResolvedReview({
        workspaceId: workspace.id,
        spaceId: dto.spaceId,
        resolved,
      });
      this.auditNegotiation(dto.spaceId, resolved);
      return resolved;
    }

    const deepSearched = isDeepSearch(feedback);
    const searchResults = deepSearched
      ? await this.reviewService.runDeepSearch(new MockSearchProvider(), item)
      : [];

    const currentSnapshot = await this.snapshotService.loadSnapshot({
      workspaceId: workspace.id,
      spaceId: dto.spaceId,
    });
    const draft = await this.reviewService.negotiateDraft(
      docSource,
      item,
      feedback,
      searchResults,
    );
    const applied = await this.applyService.applyDraft({
      workspaceId: workspace.id,
      spaceId: dto.spaceId,
      user,
      item,
      draft,
      docs: currentSnapshot?.docs ?? (await docSource.getDocMeta()),
    });

    const resolved: ResolvedReview = {
      item,
      feedback,
      skipped: false,
      deepSearched,
      searchResults,
      draft,
      applied,
    };
    await this.snapshotService.saveResolvedReview({
      workspaceId: workspace.id,
      spaceId: dto.spaceId,
      resolved,
    });
    this.auditNegotiation(dto.spaceId, resolved);
    return resolved;
  }

  private buildSource(
    workspaceId: string,
    spaceId?: string,
    limit?: number,
  ): KnowledgeArtifactWikiSource {
    return new KnowledgeArtifactWikiSource(this.capsuleRepo, {
      workspaceId,
      spaceId: spaceId as string,
      limit,
    });
  }

  private assertAdmin(user: User): void {
    if (user.role !== UserRole.OWNER && user.role !== UserRole.ADMIN) {
      throw new ForbiddenException('LLM wiki review is restricted to admins');
    }
  }

  private assertAiEnabled(workspace: Workspace): void {
    if (!isKnowledgeAiEnabledForWorkspace(workspace)) {
      throw new ForbiddenException('AI knowledge chat is disabled');
    }
  }

  private auditNegotiation(spaceId: string, resolved: ResolvedReview): void {
    this.auditService.log({
      event: AuditEvent.KNOWLEDGE_REVIEW_NEGOTIATED,
      resourceType: AuditResource.KNOWLEDGE,
      resourceId: spaceId,
      spaceId,
      metadata: {
        reviewItemId: resolved.item.id,
        reviewItemType: resolved.item.type,
        feedbackKind: classifyFeedback(resolved.feedback),
        skipped: resolved.skipped,
        deepSearched: resolved.deepSearched,
        searchResultCount: resolved.searchResults.length,
        draftApproach: resolved.draft?.approach ?? null,
        hasDraft: Boolean(resolved.draft),
        targetDocId: resolved.draft?.targetDocId ?? null,
        applied: Boolean(resolved.applied),
        appliedAction: resolved.applied?.action ?? null,
        appliedPageId: resolved.applied?.pageId ?? null,
      },
    });
  }
}

function countReviewItemTypes(
  items: Array<{ type: string }>,
): Record<string, number> {
  return items.reduce<Record<string, number>>((counts, item) => {
    counts[item.type] = (counts[item.type] ?? 0) + 1;
    return counts;
  }, {});
}

function classifyFeedback(
  feedback: string,
): 'skip' | 'deep_search' | 'accept' | 'free_text' {
  if (isSkip(feedback)) return 'skip';
  if (isDeepSearch(feedback)) return 'deep_search';
  return feedback.trim() === '采纳' ? 'accept' : 'free_text';
}
