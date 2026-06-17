import { ForbiddenException } from '@nestjs/common';
import { Workspace } from '@docmost/db/types/entity.types';
import { KnowledgeContextPackService } from './knowledge-context-pack.service';
import { KnowledgeCitationResolverService } from './knowledge-citation-resolver.service';
import { KNOWLEDGE_COMPLETENESS_NOTICE } from './knowledge-retrieval.service';
import { KnowledgeRetrievalService } from './knowledge-retrieval.service';
import {
  AiKnowledgeChatService,
  KnowledgeAnswerProvider,
} from './ai-knowledge-chat.service';

describe('AiKnowledgeChatService', () => {
  it('retrieves, packs authorized chunk context, and returns answer without raw capsules', async () => {
    const retrieval = {
      retrieve: jest.fn().mockResolvedValue({
        mode: 'high_completeness',
        chunks: [
          {
            chunk: chunk('chunk-1', 'kp-1', '登记批准日期：2026年06月05日'),
            page: capsule('kp-1', 'Chaterm'),
            sourcePageIds: ['page-1'],
          },
        ],
        capsules: [],
        completenessNotice: KNOWLEDGE_COMPLETENESS_NOTICE,
      }),
    };
    const contextPack = {
      buildContextPack: jest.fn().mockReturnValue({
        context: '# Chaterm\n登记批准日期：2026年06月05日',
        citations: [{ sourcePageId: 'page-1', title: 'Kafka', url: '/p/page-1' }],
        completenessNotice: KNOWLEDGE_COMPLETENESS_NOTICE,
      }),
    };
    const answerProvider = {
      answer: jest.fn().mockResolvedValue('Kafka is used for async events.'),
    };
    const citationResolver = {
      resolveForCapsules: jest.fn(),
      resolveForChunks: jest.fn().mockResolvedValue([
        {
          chunk: chunk('chunk-1', 'kp-1', '登记批准日期：2026年06月05日'),
          pageTitle: 'Chaterm',
          citations: [
            { sourcePageId: 'page-1', title: 'Kafka', url: '/p/page-1' },
          ],
        },
      ]),
    };
    const service = createService({
      retrieval,
      contextPack,
      answerProvider,
      citationResolver,
    });

    await expect(
      service.chat({
        workspaceId: 'workspace-1',
        userId: 'user-1',
        query: 'Chaterm 登记批准日期',
        spaceIds: ['space-1'],
        chatContext: ['Previous turn'],
      }),
    ).resolves.toEqual({
      answer: 'Kafka is used for async events.',
      citations: [{ sourcePageId: 'page-1', title: 'Kafka', url: '/p/page-1' }],
      completenessNotice: KNOWLEDGE_COMPLETENESS_NOTICE,
    });

    expect(retrieval.retrieve).toHaveBeenCalledWith({
      workspaceId: 'workspace-1',
      userId: 'user-1',
      query: 'Chaterm 登记批准日期',
      spaceIds: ['space-1'],
    });
    expect(contextPack.buildContextPack).toHaveBeenCalledWith({
      chunks: [
        {
          chunk: chunk('chunk-1', 'kp-1', '登记批准日期：2026年06月05日'),
          pageTitle: 'Chaterm',
          citations: [
            { sourcePageId: 'page-1', title: 'Kafka', url: '/p/page-1' },
          ],
        },
      ],
    });
    expect(citationResolver.resolveForChunks).toHaveBeenCalledWith({
      workspaceId: 'workspace-1',
      chunks: [
        {
          chunk: chunk('chunk-1', 'kp-1', '登记批准日期：2026年06月05日'),
          page: capsule('kp-1', 'Chaterm'),
          sourcePageIds: ['page-1'],
        },
      ],
    });
    expect(citationResolver.resolveForCapsules).not.toHaveBeenCalled();
    expect(answerProvider.answer).toHaveBeenCalledWith({
      query: 'Chaterm 登记批准日期',
      context: '# Chaterm\n登记批准日期：2026年06月05日',
      chatContext: ['Previous turn'],
    });
  });

  it('allows knowledge chat when the workspace switch is enabled without requiring an AI license feature', async () => {
    const service = createService({
      answerProvider: { answer: jest.fn().mockResolvedValue('grounded answer') },
    });

    await expect(
      service.chat({
        workspaceId: 'workspace-1',
        userId: 'user-1',
        query: 'Kafka?',
        spaceIds: ['space-1'],
        workspace: workspace({ aiChat: true }),
      }),
    ).resolves.toMatchObject({
      answer: 'grounded answer',
      citations: [],
    });
  });

  it('enables chat when workspace ai.chat is enabled', () => {
    const service = createService();

    expect(service.isEnabledForWorkspace(workspace({ aiChat: true }))).toBe(true);
    expect(service.isEnabledForWorkspace(workspace({ aiChat: false }))).toBe(false);
  });
});

function createService(overrides: {
  retrieval?: Partial<KnowledgeRetrievalService>;
  contextPack?: Partial<KnowledgeContextPackService>;
  citationResolver?: Partial<KnowledgeCitationResolverService>;
  answerProvider?: Partial<KnowledgeAnswerProvider>;
} = {}) {
  return new AiKnowledgeChatService(
    {
      retrieve: jest.fn().mockResolvedValue({
        mode: 'high_completeness',
        chunks: [],
        capsules: [],
        completenessNotice: KNOWLEDGE_COMPLETENESS_NOTICE,
      }),
      ...overrides.retrieval,
    } as unknown as KnowledgeRetrievalService,
    {
      buildContextPack: jest.fn().mockReturnValue({
        context: '',
        citations: [],
        completenessNotice: KNOWLEDGE_COMPLETENESS_NOTICE,
      }),
      ...overrides.contextPack,
    } as unknown as KnowledgeContextPackService,
    {
      resolveForCapsules: jest.fn().mockResolvedValue([]),
      resolveForChunks: jest.fn().mockResolvedValue([]),
      ...overrides.citationResolver,
    } as unknown as KnowledgeCitationResolverService,
    {
      answer: jest.fn().mockResolvedValue(''),
      ...overrides.answerProvider,
    } as unknown as KnowledgeAnswerProvider,
  );
}

function workspace(input: { aiChat: boolean }): Workspace {
  return {
    id: 'workspace-1',
    licenseKey: 'license-key',
    plan: 'business',
    settings: { ai: { chat: input.aiChat } },
  } as unknown as Workspace;
}

function capsule(id: string, title = 'Kafka') {
  return {
    id,
    workspaceId: 'workspace-1',
    spaceId: 'space-1',
    compileScope: 'space',
    title,
    slug: id,
    pageType: null,
    body: 'Use Kafka.',
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

function chunk(id: string, knowledgePageId: string, text: string) {
  return {
    id,
    workspaceId: 'workspace-1',
    spaceId: 'space-1',
    knowledgePageId,
    claimId: null,
    text,
    contentHash: `hash-${id}`,
    embedding: [0.1, 0.2],
    compilerRunId: 'run-1',
    compileTaskId: 'task-1',
    staleAt: null,
    createdAt: new Date('2026-06-16T00:00:00.000Z'),
  };
}
