import { KnowledgeCapsuleRepo } from '@docmost/db/repos/llm-wiki/knowledge-capsule.repo';
import { UserRepo } from '@docmost/db/repos/user/user.repo';
import { UserRole } from '../../../common/helpers/types/permission';
import { SpaceAuthorizationService } from '../../../core/space/services/space-authorization.service';
import {
  ConfiguredKnowledgeEmbeddingProvider,
  KnowledgeEmbeddingProvider,
} from './knowledge-embedding-provider.service';
import { KnowledgeRetrievalRankerService } from './knowledge-retrieval-ranker.service';
import { KnowledgeSourceAuthorizationService } from './knowledge-source-authorization.service';
import { KnowledgeRetrievalService } from './knowledge-retrieval.service';

describe('KnowledgeRetrievalService', () => {
  it('retrieves candidates from compiled chunk embeddings before final source authorization', async () => {
    const capsuleRepo = {
      findEmbeddedChunkCandidates: jest.fn().mockResolvedValue([
        chunk('chunk-1', 'kp-1', [0.2, 0.8], 'Kafka deployment notes'),
        chunk('chunk-2', 'kp-2', [0.95, 0.05], 'AkashaQwenSmokeTest retrieval'),
      ]),
      findPagesByIds: jest
        .fn()
        .mockResolvedValue([candidate('kp-2', 'space-1'), candidate('kp-1', 'space-1')]),
      findChunkSourcePageIds: jest
        .fn()
        .mockResolvedValueOnce(['source-3'])
        .mockResolvedValueOnce(['source-1', 'source-2']),
    };
    const sourceAuthorization = {
      filterReadableSources: jest
        .fn()
        .mockResolvedValueOnce(['source-3'])
        .mockResolvedValueOnce(['source-1']),
    };
    const embeddingProvider = {
      embedQuery: jest.fn().mockResolvedValue([1, 0]),
    };
    const service = createService({
      capsuleRepo,
      sourceAuthorization,
      embeddingProvider,
    });

    await expect(
      service.retrieve({
        workspaceId: 'workspace-1',
        userId: 'user-1',
        query: 'AkashaQwenSmokeTest 是什么？',
        spaceIds: ['space-1', 'space-2'],
      }),
    ).resolves.toEqual({
      mode: 'high_completeness',
      chunks: [
        {
          chunk: chunk(
            'chunk-2',
            'kp-2',
            [0.95, 0.05],
            'AkashaQwenSmokeTest retrieval',
          ),
          page: candidate('kp-2', 'space-1'),
          sourcePageIds: ['source-3'],
        },
      ],
      capsules: [],
      completenessNotice:
        'Some knowledge may be unavailable because access is permission-scoped.',
    });

    expect(embeddingProvider.embedQuery).toHaveBeenCalledWith(
      'AkashaQwenSmokeTest 是什么？',
    );
    expect(capsuleRepo.findEmbeddedChunkCandidates).toHaveBeenCalledWith({
      workspaceId: 'workspace-1',
      spaceIds: ['space-1'],
      limit: 200,
    });
    expect(capsuleRepo.findPagesByIds).toHaveBeenCalledWith({
      workspaceId: 'workspace-1',
      knowledgePageIds: ['kp-2', 'kp-1'],
    });
    expect(sourceAuthorization.filterReadableSources).toHaveBeenCalledWith({
      workspaceId: 'workspace-1',
      userId: 'user-1',
      sourcePageIds: ['source-3'],
    });
  });

  it('does not query candidates when the user has no readable spaces', async () => {
    const capsuleRepo = {
      findEmbeddedChunkCandidates: jest.fn(),
      findDependencySourcePageIds: jest.fn(),
    };
    const service = createService({
      capsuleRepo,
      spaceAuthorization: { filterReadableSpaceIds: jest.fn().mockResolvedValue([]) },
    });

    await expect(
      service.retrieve({
        workspaceId: 'workspace-1',
        userId: 'user-1',
        query: 'kafka',
        spaceIds: ['space-1'],
      }),
    ).resolves.toEqual({
      mode: 'high_completeness',
      chunks: [],
      capsules: [],
      completenessNotice:
        'Some knowledge may be unavailable because access is permission-scoped.',
    });

    expect(capsuleRepo.findEmbeddedChunkCandidates).not.toHaveBeenCalled();
  });

  it('caps candidate count and dependency checks', async () => {
    const candidateRows = Array.from({ length: 50 }, (_, index) =>
      candidate(`kp-${index}`, 'space-1'),
    );
    const capsuleRepo = {
      findEmbeddedChunkCandidates: jest
        .fn()
        .mockResolvedValue(
          candidateRows.map((row, index) =>
            chunk(`chunk-${index}`, row.id, [1, 0], `Chunk ${index}`),
          ),
        ),
      findPagesByIds: jest.fn().mockResolvedValue(candidateRows),
      findDependencySourcePageIds: jest.fn().mockResolvedValue(['source-1']),
      findChunkSourcePageIds: jest.fn().mockResolvedValue(['source-1']),
    };
    const service = createService({
      capsuleRepo,
      embeddingProvider: { embedQuery: jest.fn().mockResolvedValue([1, 0]) },
    });

    const result = await service.retrieve({
      workspaceId: 'workspace-1',
      userId: 'user-1',
      query: 'kafka',
      spaceIds: ['space-1'],
      candidateLimit: 5,
    });

    expect(capsuleRepo.findEmbeddedChunkCandidates).toHaveBeenCalledWith(
      expect.objectContaining({ limit: 50 }),
    );
    expect(capsuleRepo.findChunkSourcePageIds).toHaveBeenCalledTimes(5);
    expect(result.chunks).toHaveLength(5);
  });

  it('does not fall back to lexical page search when query embedding is unavailable', async () => {
    const capsuleRepo = {
      findEmbeddedChunkCandidates: jest.fn(),
      findPageCandidates: jest.fn(),
      findDependencySourcePageIds: jest.fn(),
    };
    const service = createService({
      capsuleRepo,
      embeddingProvider: { embedQuery: jest.fn().mockResolvedValue(null) },
    });

    await expect(
      service.retrieve({
        workspaceId: 'workspace-1',
        userId: 'user-1',
        query: 'AkashaQwenSmokeTest 是什么？',
        spaceIds: ['space-1'],
      }),
    ).resolves.toEqual({
      mode: 'high_completeness',
      chunks: [],
      capsules: [],
      completenessNotice:
        'Some knowledge may be unavailable because access is permission-scoped.',
    });

    expect(capsuleRepo.findEmbeddedChunkCandidates).not.toHaveBeenCalled();
    expect(capsuleRepo.findPageCandidates).not.toHaveBeenCalled();
  });
});

function createService(overrides: {
  userRepo?: Partial<UserRepo>;
  spaceAuthorization?: Partial<SpaceAuthorizationService>;
  capsuleRepo?: Partial<KnowledgeCapsuleRepo>;
  sourceAuthorization?: Partial<KnowledgeSourceAuthorizationService>;
  embeddingProvider?: Partial<KnowledgeEmbeddingProvider>;
} = {}) {
  const userRepo = {
    findById: jest.fn().mockResolvedValue({
      id: 'user-1',
      role: UserRole.MEMBER,
      workspaceId: 'workspace-1',
    }),
    ...overrides.userRepo,
  };
  const spaceAuthorization = {
    filterReadableSpaceIds: jest.fn().mockResolvedValue(['space-1']),
    ...overrides.spaceAuthorization,
  };
  const capsuleRepo = {
    findEmbeddedChunkCandidates: jest.fn().mockResolvedValue([]),
    findPagesByIds: jest.fn().mockResolvedValue([]),
    findDependencySourcePageIds: jest.fn().mockResolvedValue([]),
    findChunkSourcePageIds: jest.fn().mockResolvedValue(['source-1']),
    ...overrides.capsuleRepo,
  };
  const sourceAuthorization = {
    filterReadableSources: jest.fn().mockResolvedValue(['source-1']),
    ...overrides.sourceAuthorization,
  };
  const embeddingProvider = {
    embedQuery: jest.fn().mockResolvedValue([1, 0]),
    ...overrides.embeddingProvider,
  };

  return new KnowledgeRetrievalService(
    userRepo as unknown as UserRepo,
    spaceAuthorization as unknown as SpaceAuthorizationService,
    capsuleRepo as unknown as KnowledgeCapsuleRepo,
    sourceAuthorization as unknown as KnowledgeSourceAuthorizationService,
    embeddingProvider as unknown as ConfiguredKnowledgeEmbeddingProvider,
    new KnowledgeRetrievalRankerService(),
  );
}

function candidate(id: string, spaceId: string) {
  return {
    id,
    workspaceId: 'workspace-1',
    spaceId,
    compileScope: 'space',
    title: `Title ${id}`,
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

function chunk(
  id: string,
  knowledgePageId: string,
  embedding: number[],
  text: string,
) {
  return {
    id,
    workspaceId: 'workspace-1',
    spaceId: 'space-1',
    knowledgePageId,
    claimId: null,
    text,
    contentHash: `${id}-hash`,
    embedding,
    compilerRunId: 'run-1',
    compileTaskId: 'task-1',
    staleAt: null,
    createdAt: new Date('2026-06-16T00:00:00.000Z'),
  };
}
