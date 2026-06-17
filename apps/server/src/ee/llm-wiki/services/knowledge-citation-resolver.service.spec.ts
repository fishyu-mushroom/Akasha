import { KnowledgeCapsuleRepo } from '@docmost/db/repos/llm-wiki/knowledge-capsule.repo';
import { PageRepo } from '@docmost/db/repos/page/page.repo';
import { KnowledgeSourceAuthorizationService } from './knowledge-source-authorization.service';
import { KnowledgeCitationResolverService } from './knowledge-citation-resolver.service';

describe('KnowledgeCitationResolverService', () => {
  it('resolves citations only from finally readable dependency source pages', async () => {
    const capsuleRepo = {
      findDependencySourcePageIds: jest
        .fn()
        .mockResolvedValueOnce(['source-1', 'source-2'])
        .mockResolvedValueOnce(['source-3']),
    };
    const sourceAuthorization = {
      filterReadableSources: jest
        .fn()
        .mockResolvedValueOnce(['source-1'])
        .mockResolvedValueOnce(['source-3']),
    };
    const pageRepo = {
      findManyByIds: jest.fn().mockResolvedValue([
        page('source-1', 'Readable 1', 'slug-1'),
        page('source-3', 'Readable 3', 'slug-3'),
      ]),
    };
    const service = new KnowledgeCitationResolverService(
      capsuleRepo as unknown as KnowledgeCapsuleRepo,
      sourceAuthorization as unknown as KnowledgeSourceAuthorizationService,
      pageRepo as unknown as PageRepo,
    );

    await expect(
      service.resolveForCapsules({
        workspaceId: 'workspace-1',
        userId: 'user-1',
        capsules: [capsule('kp-1'), capsule('kp-2')],
      }),
    ).resolves.toEqual([
      {
        capsule: capsule('kp-1'),
        citations: [
          {
            sourcePageId: 'source-1',
            title: 'Readable 1',
            url: '/p/slug-1',
          },
        ],
      },
      {
        capsule: capsule('kp-2'),
        citations: [
          {
            sourcePageId: 'source-3',
            title: 'Readable 3',
            url: '/p/slug-3',
          },
        ],
      },
    ]);

    expect(sourceAuthorization.filterReadableSources).toHaveBeenCalledWith({
      workspaceId: 'workspace-1',
      userId: 'user-1',
      sourcePageIds: ['source-1', 'source-2'],
    });
    expect(pageRepo.findManyByIds).toHaveBeenCalledWith(
      ['source-1', 'source-3'],
      { workspaceId: 'workspace-1' },
    );
  });

  it('does not query pages when there are no readable dependency sources', async () => {
    const pageRepo = {
      findManyByIds: jest.fn(),
    };
    const service = new KnowledgeCitationResolverService(
      {
        findDependencySourcePageIds: jest.fn().mockResolvedValue(['source-1']),
      } as unknown as KnowledgeCapsuleRepo,
      {
        filterReadableSources: jest.fn().mockResolvedValue([]),
      } as unknown as KnowledgeSourceAuthorizationService,
      pageRepo as unknown as PageRepo,
    );

    await expect(
      service.resolveForCapsules({
        workspaceId: 'workspace-1',
        userId: 'user-1',
        capsules: [capsule('kp-1')],
      }),
    ).resolves.toEqual([{ capsule: capsule('kp-1'), citations: [] }]);

    expect(pageRepo.findManyByIds).not.toHaveBeenCalled();
  });

  it('resolves chunk citations from the chunk source pages without falling back to whole capsule dependencies', async () => {
    const capsuleRepo = {
      findDependencySourcePageIds: jest.fn(),
    };
    const sourceAuthorization = {
      filterReadableSources: jest.fn(),
    };
    const pageRepo = {
      findManyByIds: jest.fn().mockResolvedValue([
        page('source-date', 'Chaterm', 'chaterm-MKu8iUqhlD'),
        page('source-kms', 'KMS_Blog', 'kms-blog'),
      ]),
    };
    const service = new KnowledgeCitationResolverService(
      capsuleRepo as unknown as KnowledgeCapsuleRepo,
      sourceAuthorization as unknown as KnowledgeSourceAuthorizationService,
      pageRepo as unknown as PageRepo,
    );

    await expect(
      service.resolveForChunks({
        workspaceId: 'workspace-1',
        chunks: [
          {
            chunk: chunk('chunk-date', 'kp-chaterm'),
            page: capsule('kp-chaterm', 'Chaterm'),
            sourcePageIds: ['source-date'],
          },
          {
            chunk: chunk('chunk-kms', 'kp-kms'),
            page: capsule('kp-kms', 'KMS_Blog'),
            sourcePageIds: ['source-kms'],
          },
        ],
      }),
    ).resolves.toEqual([
      {
        chunk: chunk('chunk-date', 'kp-chaterm'),
        pageTitle: 'Chaterm',
        citations: [
          {
            sourcePageId: 'source-date',
            title: 'Chaterm',
            url: '/p/chaterm-MKu8iUqhlD',
          },
        ],
      },
      {
        chunk: chunk('chunk-kms', 'kp-kms'),
        pageTitle: 'KMS_Blog',
        citations: [
          {
            sourcePageId: 'source-kms',
            title: 'KMS_Blog',
            url: '/p/kms-blog',
          },
        ],
      },
    ]);

    expect(capsuleRepo.findDependencySourcePageIds).not.toHaveBeenCalled();
    expect(sourceAuthorization.filterReadableSources).not.toHaveBeenCalled();
    expect(pageRepo.findManyByIds).toHaveBeenCalledWith(
      ['source-date', 'source-kms'],
      { workspaceId: 'workspace-1' },
    );
  });
});

function capsule(id: string, title = `Title ${id}`) {
  return {
    id,
    workspaceId: 'workspace-1',
    spaceId: 'space-1',
    compileScope: 'space',
    title,
    slug: id,
    pageType: null,
    body: `Body ${id}`,
    summary: null,
    compiledAt: new Date('2026-06-16T00:00:00.000Z'),
    compilerVersion: 'compiler@1',
    compilerRunId: 'run-1',
    compileTaskId: 'task-1',
    staleAt: null,
    createdAt: new Date('2026-06-16T00:00:00.000Z'),
    updatedAt: new Date('2026-06-16T00:00:00.000Z'),
  };
}

function chunk(id: string, knowledgePageId: string) {
  return {
    id,
    workspaceId: 'workspace-1',
    spaceId: 'space-1',
    knowledgePageId,
    claimId: null,
    text: `Text ${id}`,
    contentHash: `hash-${id}`,
    embedding: [0.1, 0.2],
    compilerRunId: 'run-1',
    compileTaskId: 'task-1',
    staleAt: null,
    createdAt: new Date('2026-06-16T00:00:00.000Z'),
  };
}

function page(id: string, title: string, slugId: string) {
  return {
    id,
    title,
    slugId,
    workspaceId: 'workspace-1',
    spaceId: 'space-1',
    deletedAt: null,
  };
}
