import { KnowledgeRetrievalRankerService } from './knowledge-retrieval-ranker.service';

describe('KnowledgeRetrievalRankerService', () => {
  it('ranks compiled chunks by semantic score and BM25 rerank, then collapses to pages', () => {
    const ranker = new KnowledgeRetrievalRankerService();

    expect(
      ranker.rankPageIds({
        query: 'AkashaQwenSmokeTest 是什么？',
        queryEmbedding: [1, 0],
        chunks: [
          chunk('chunk-1', 'kp-semantic-only', [1, 0], 'Unrelated compiled chunk'),
          chunk(
            'chunk-2',
            'kp-exact',
            [0.6, 0.8],
            'AkashaQwenSmokeTest retrieval behavior',
          ),
          chunk('chunk-3', 'kp-exact', [0.7, 0.7], 'AkashaQwenSmokeTest setup'),
        ],
        limit: 2,
      }),
    ).toEqual(['kp-exact', 'kp-semantic-only']);
  });

  it('drops chunks with malformed or dimension-mismatched embeddings', () => {
    const ranker = new KnowledgeRetrievalRankerService();

    expect(
      ranker.rankPageIds({
        query: 'retrieval',
        queryEmbedding: [1, 0],
        chunks: [
          chunk('chunk-1', 'kp-1', [1], 'retrieval'),
          chunk('chunk-2', 'kp-2', null, 'retrieval'),
          chunk('chunk-3', 'kp-3', [1, 0], 'retrieval'),
        ],
        limit: 10,
      }),
    ).toEqual(['kp-3']);
  });

  it('uses Chinese query terms when reranking exact factual chunks', () => {
    const ranker = new KnowledgeRetrievalRankerService();

    expect(
      ranker.rankChunks({
        query: 'chaterm 登记批准日期',
        queryEmbedding: [1, 0],
        chunks: [
          chunk(
            'chunk-kms',
            'kp-kms',
            [1, 0],
            'Chaterm 使用 AWS KMS 信封加密保护用户数据。',
          ),
          chunk(
            'chunk-date',
            'kp-date',
            [0.4, 0.9],
            '软件名称：合合信息Chaterm企业版软件 登记批准日期：2026年06月05日',
          ),
        ],
        limit: 2,
      }).map((item) => item.id),
    ).toEqual(['chunk-date', 'chunk-kms']);
  });
});

function chunk(
  id: string,
  knowledgePageId: string,
  embedding: number[] | null,
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
