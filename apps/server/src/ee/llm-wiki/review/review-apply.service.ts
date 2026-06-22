import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { PageRepo } from '@docmost/db/repos/page/page.repo';
import { Page, User } from '@docmost/db/types/entity.types';
import SpaceAbilityFactory from '../../../core/casl/abilities/space-ability.factory';
import {
  SpaceCaslAction,
  SpaceCaslSubject,
} from '../../../core/casl/interfaces/space-ability.type';
import { PageAccessService } from '../../../core/page/page-access/page-access.service';
import {
  ContentOperation,
  UpdatePageDto,
} from '../../../core/page/dto/update-page.dto';
import { PageService } from '../../../core/page/services/page.service';
import { ReviewDocMeta } from './knowledge-artifact-wiki-source';
import { AppliedReviewResult, DraftContent, ReviewItem } from './review.schema';

@Injectable()
export class ReviewApplyService {
  constructor(
    private readonly pageService: PageService,
    private readonly pageRepo: PageRepo,
    private readonly pageAccessService: PageAccessService,
    private readonly spaceAbility: SpaceAbilityFactory,
  ) {}

  async applyDraft(input: {
    workspaceId: string;
    spaceId: string;
    user: User;
    item: ReviewItem;
    draft: DraftContent;
    docs: ReviewDocMeta[];
  }): Promise<AppliedReviewResult> {
    switch (input.draft.approach) {
      case 'new-page':
      case 'clarify':
        return this.createPage(input);
      case 'section':
        return this.updateExistingPage(input, 'append');
      case 'rewrite':
      case 'merge':
        return this.updateExistingPage(input, 'replace');
    }
  }

  private async createPage(input: {
    workspaceId: string;
    spaceId: string;
    user: User;
    draft: DraftContent;
  }): Promise<AppliedReviewResult> {
    const ability = await this.spaceAbility.createForUser(
      input.user,
      input.spaceId,
    );
    if (ability.cannot(SpaceCaslAction.Create, SpaceCaslSubject.Page)) {
      throw new ForbiddenException();
    }

    const created = await this.pageService.create(
      input.user.id,
      input.workspaceId,
      {
        title: input.draft.title,
        spaceId: input.spaceId,
        content: input.draft.body,
        format: 'markdown',
      },
    );

    const page = await this.pageRepo.findById(created.id, {
      includeSpace: true,
    });
    if (!page) {
      throw new NotFoundException('Created page not found');
    }

    return toAppliedResult(page, 'created');
  }

  private async updateExistingPage(
    input: {
      item: ReviewItem;
      user: User;
      draft: DraftContent;
      docs: ReviewDocMeta[];
    },
    operation: ContentOperation,
  ): Promise<AppliedReviewResult> {
    const sourcePageId = resolveTargetSourcePageId(
      input.item,
      input.draft,
      input.docs,
    );
    if (!sourcePageId) {
      throw new BadRequestException(
        'Review draft could not be mapped to a writable source page',
      );
    }

    const page = await this.pageRepo.findById(sourcePageId, {
      includeSpace: true,
    });
    if (!page || page.deletedAt) {
      throw new NotFoundException('Target page not found');
    }

    await this.pageAccessService.validateCanEdit(page, input.user);

    const updateDto: UpdatePageDto = {
      pageId: page.id,
      content: input.draft.body,
      format: 'markdown',
      operation,
    };

    if (operation === 'replace') {
      updateDto.title = input.draft.title;
    }

    const updated = await this.pageService.update(page, updateDto, input.user);
    return toAppliedResult(updated, 'updated');
  }
}

function resolveTargetSourcePageId(
  item: ReviewItem,
  draft: DraftContent,
  docs: ReviewDocMeta[],
): string | undefined {
  const docsById = new Map(docs.map((doc) => [doc.id, doc]));
  const explicitTargetId = draft.targetDocId ?? fallbackTargetDocId(item);
  return explicitTargetId
    ? docsById.get(explicitTargetId)?.sourcePageId
    : undefined;
}

function fallbackTargetDocId(item: ReviewItem): string | null {
  switch (item.type) {
    case 'suggestion':
      return item.targetDocId;
    case 'duplicate':
      return item.suggestedPrimaryId;
    default:
      return null;
  }
}

function toAppliedResult(
  page: Page & { space?: { slug?: string | null } | null },
  action: AppliedReviewResult['action'],
): AppliedReviewResult {
  return {
    pageId: page.id,
    pageTitle: page.title ?? 'Untitled',
    pageSlugId: page.slugId,
    spaceSlug: page.space?.slug ?? null,
    action,
  };
}
