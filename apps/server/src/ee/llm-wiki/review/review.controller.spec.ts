import { ForbiddenException } from '@nestjs/common';
import { KnowledgeCapsuleRepo } from '@docmost/db/repos/llm-wiki/knowledge-capsule.repo';
import { User, Workspace } from '@docmost/db/types/entity.types';
import { AuditEvent, AuditResource } from '../../../common/events/audit-events';
import { UserRole } from '../../../common/helpers/types/permission';
import { IAuditService } from '../../../integrations/audit/audit.service';
import { ReviewService } from './review.service';
import { ReviewController } from './review.controller';
import { ReviewItem } from './review.schema';
import { ReviewSnapshotService } from './review-snapshot.service';
import type { ReviewApplyService } from './review-apply.service';

jest.mock('./review-apply.service', () => ({
  ReviewApplyService: class ReviewApplyService {},
}));

describe('ReviewController', () => {
  it('rejects review discovery when workspace AI is disabled', async () => {
    const reviewService = {
      reviewWiki: jest.fn(),
    };
    const auditService = {
      log: jest.fn(),
    };
    const controller = createController({ reviewService, auditService });

    await expect(
      controller.discover(
        { spaceId: 'space-1' },
        adminUser(),
        workspace({ ai: { chat: false } }),
      ),
    ).rejects.toBeInstanceOf(ForbiddenException);

    expect(reviewService.reviewWiki).not.toHaveBeenCalled();
    expect(auditService.log).not.toHaveBeenCalled();
  });

  it('loads the saved snapshot for a space', async () => {
    const snapshotService = {
      loadSnapshot: jest.fn().mockResolvedValue({
        version: '2',
        items: [],
        docs: [],
        resolvedReviews: [],
        discoveredAt: '2026-06-22T03:00:00.000Z',
        updatedAt: '2026-06-22T03:00:00.000Z',
      }),
    };
    const controller = createController({ snapshotService });

    await expect(
      controller.load({ spaceId: 'space-1' }, adminUser(), workspace()),
    ).resolves.toEqual({
      version: '2',
      items: [],
      docs: [],
      resolvedReviews: [],
      discoveredAt: '2026-06-22T03:00:00.000Z',
      updatedAt: '2026-06-22T03:00:00.000Z',
    });

    expect(snapshotService.loadSnapshot).toHaveBeenCalledWith({
      workspaceId: 'workspace-1',
      spaceId: 'space-1',
    });
  });

  it('audits review discovery without storing review content', async () => {
    const item: ReviewItem = {
      id: 'rev-1',
      type: 'suggestion',
      title: 'Improve launch notes',
      detail: 'Private launch detail should not be audited.',
      recommendation: 'Add operational readiness context.',
      relatedDocIds: ['kp-1'],
      searchQueries: ['launch readiness'],
      targetDocId: 'kp-1',
    };
    const reviewService = {
      reviewWiki: jest.fn().mockResolvedValue({
        version: '2',
        items: [item],
      }),
    };
    const auditService = {
      log: jest.fn(),
    };
    const controller = createController({
      reviewService,
      auditService,
      snapshotService: {
        replaceDiscoveredSnapshot: jest.fn().mockResolvedValue({
          version: '2',
          items: [item],
          docs: [{ id: 'kp-1', title: 'Launch plan', sourcePageId: 'page-1' }],
          resolvedReviews: [],
          discoveredAt: '2026-06-22T03:00:00.000Z',
          updatedAt: '2026-06-22T03:00:00.000Z',
        }),
      },
      capsuleRepo: capsuleRepoWithPages(),
    });

    await expect(
      controller.discover(
        { spaceId: 'space-1', limit: 20 },
        adminUser(),
        workspace(),
      ),
    ).resolves.toEqual({
      version: '2',
      items: [item],
      docs: [{ id: 'kp-1', title: 'Launch plan', sourcePageId: 'page-1' }],
      resolvedReviews: [],
      discoveredAt: '2026-06-22T03:00:00.000Z',
      updatedAt: '2026-06-22T03:00:00.000Z',
    });

    expect(auditService.log).toHaveBeenCalledWith({
      event: AuditEvent.KNOWLEDGE_REVIEW_DISCOVERED,
      resourceType: AuditResource.KNOWLEDGE,
      resourceId: 'space-1',
      spaceId: 'space-1',
      metadata: {
        limit: 20,
        documentCount: 1,
        reviewItemCount: 1,
        reviewItemTypes: { suggestion: 1 },
      },
    });
    expect(JSON.stringify(auditService.log.mock.calls)).not.toContain(
      'Private launch detail',
    );
  });

  it('audits skipped negotiation without generating a draft', async () => {
    const item: ReviewItem = {
      id: 'rev-2',
      type: 'missing-page',
      title: 'Add rollout page',
      detail: 'Rollout is referenced but missing.',
      recommendation: 'Create a rollout page.',
      relatedDocIds: ['kp-1'],
      searchQueries: ['rollout plan'],
      outline: ['Goal', 'Steps'],
    };
    const reviewService = {
      runDeepSearch: jest.fn(),
      negotiateDraft: jest.fn(),
    };
    const auditService = {
      log: jest.fn(),
    };
    const controller = createController({
      reviewService,
      auditService,
      snapshotService: {
        saveResolvedReview: jest.fn().mockResolvedValue(undefined),
      },
      capsuleRepo: capsuleRepoWithPages(),
    });

    await expect(
      controller.negotiate(
        { spaceId: 'space-1', item, feedback: '暂时跳过' },
        adminUser(),
        workspace(),
      ),
    ).resolves.toEqual({
      item,
      feedback: '暂时跳过',
      skipped: true,
      deepSearched: false,
      searchResults: [],
      draft: null,
      applied: null,
    });

    expect(reviewService.runDeepSearch).not.toHaveBeenCalled();
    expect(reviewService.negotiateDraft).not.toHaveBeenCalled();
    expect(auditService.log).toHaveBeenCalledWith({
      event: AuditEvent.KNOWLEDGE_REVIEW_NEGOTIATED,
      resourceType: AuditResource.KNOWLEDGE,
      resourceId: 'space-1',
      spaceId: 'space-1',
      metadata: {
        reviewItemId: 'rev-2',
        reviewItemType: 'missing-page',
        feedbackKind: 'skip',
        skipped: true,
        deepSearched: false,
        searchResultCount: 0,
        draftApproach: null,
        hasDraft: false,
        targetDocId: null,
        applied: false,
        appliedAction: null,
        appliedPageId: null,
      },
    });
  });
});

function createController(
  overrides: {
    reviewService?: Partial<ReviewService>;
    applyService?: Partial<ReviewApplyService>;
    snapshotService?: Partial<ReviewSnapshotService>;
    capsuleRepo?: Partial<KnowledgeCapsuleRepo>;
    auditService?: Partial<IAuditService>;
  } = {},
): ReviewController {
  const reviewService = {
    reviewWiki: jest.fn().mockResolvedValue({ version: '2', items: [] }),
    runDeepSearch: jest.fn().mockResolvedValue([]),
    negotiateDraft: jest.fn(),
    ...overrides.reviewService,
  } as unknown as ReviewService;
  const capsuleRepo = {
    findGraphCandidatesForSpace: jest.fn().mockResolvedValue({
      pages: [],
      pageSources: [],
      links: [],
      linkSources: [],
      graphEdges: [],
      graphEdgeSources: [],
    }),
    findClaimsByPageIds: jest.fn().mockResolvedValue([]),
    ...overrides.capsuleRepo,
  } as unknown as KnowledgeCapsuleRepo;
  const auditService = {
    log: jest.fn(),
    ...overrides.auditService,
  } as unknown as IAuditService;
  const snapshotService = {
    loadSnapshot: jest.fn().mockResolvedValue(null),
    replaceDiscoveredSnapshot: jest.fn().mockResolvedValue({
      version: '2',
      items: [],
      docs: [],
      resolvedReviews: [],
      discoveredAt: '2026-06-22T03:00:00.000Z',
      updatedAt: '2026-06-22T03:00:00.000Z',
    }),
    saveResolvedReview: jest.fn().mockResolvedValue(undefined),
    ...overrides.snapshotService,
  } as unknown as ReviewSnapshotService;
  const applyService = {
    applyDraft: jest.fn().mockResolvedValue({
      pageId: 'page-1',
      pageTitle: 'Launch plan',
      pageSlugId: 'page-1',
      spaceSlug: 'space-1',
      action: 'updated',
    }),
    ...overrides.applyService,
  } as unknown as ReviewApplyService;

  return new ReviewController(
    reviewService,
    applyService,
    snapshotService,
    capsuleRepo,
    auditService,
  );
}

function capsuleRepoWithPages(): Partial<KnowledgeCapsuleRepo> {
  return {
    findGraphCandidatesForSpace: jest.fn().mockResolvedValue({
      pages: [
        {
          id: 'kp-1',
          workspaceId: 'workspace-1',
          spaceId: 'space-1',
          title: 'Launch plan',
          body: 'Private launch body should not be audited.',
          pageType: 'source_summary',
          staleAt: null,
        },
      ],
      pageSources: [
        {
          knowledgePageId: 'kp-1',
          sourcePageId: 'page-1',
        },
      ],
      links: [],
      linkSources: [],
      graphEdges: [],
      graphEdgeSources: [],
    }),
    findClaimsByPageIds: jest.fn().mockResolvedValue([]),
  };
}

function workspace(settings: Record<string, unknown> = { ai: { chat: true } }) {
  return {
    id: 'workspace-1',
    settings,
  } as Workspace;
}

function adminUser(): User {
  return {
    id: 'user-1',
    role: UserRole.ADMIN,
  } as User;
}
