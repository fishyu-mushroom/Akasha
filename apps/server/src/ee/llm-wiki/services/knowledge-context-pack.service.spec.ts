import { KNOWLEDGE_COMPLETENESS_NOTICE } from './knowledge-retrieval.service';
import { KnowledgeContextPackService } from './knowledge-context-pack.service';

describe('KnowledgeContextPackService', () => {
  it('builds context from authorized capsules and readable citations only', () => {
    const service = new KnowledgeContextPackService();

    const pack = service.buildContextPack({
      capsules: [
        {
          capsule: capsule('kp-1', 'Kafka Guide', 'Use Kafka for async events.'),
          citations: [
            {
              sourcePageId: 'page-1',
              title: 'Readable Page',
              url: '/s/space/page-1',
            },
          ],
        },
        {
          capsule: capsule('kp-2', 'Hidden Source Derived', 'Authorized body.'),
          citations: [],
        },
      ],
    });

    expect(pack).toEqual({
      context: [
        '# Kafka Guide',
        'Use Kafka for async events.',
        '',
        '# Hidden Source Derived',
        'Authorized body.',
      ].join('\n'),
      citations: [
        {
          sourcePageId: 'page-1',
          title: 'Readable Page',
          url: '/s/space/page-1',
        },
      ],
      completenessNotice: KNOWLEDGE_COMPLETENESS_NOTICE,
    });
  });

  it('does not reveal filtered counts or denied reasons', () => {
    const service = new KnowledgeContextPackService();

    const pack = service.buildContextPack({
      capsules: [],
    });

    expect(pack.context).toBe('');
    expect(pack.citations).toEqual([]);
    expect(pack.completenessNotice).toBe(KNOWLEDGE_COMPLETENESS_NOTICE);
    expect(JSON.stringify(pack)).not.toContain('denied');
    expect(JSON.stringify(pack)).not.toContain('filtered');
    expect(JSON.stringify(pack)).not.toContain('hidden');
  });

  it('limits context size while preserving capsule order', () => {
    const service = new KnowledgeContextPackService();

    const pack = service.buildContextPack({
      capsules: [
        { capsule: capsule('kp-1', 'First', 'A'.repeat(9000)) },
        { capsule: capsule('kp-2', 'Second', 'B'.repeat(9000)) },
      ],
    });

    expect(pack.context.length).toBeLessThanOrEqual(12000);
    expect(pack.context).toContain('# First');
    expect(pack.context).toContain('# Second');
    expect(pack.context.indexOf('# First')).toBeLessThan(
      pack.context.indexOf('# Second'),
    );
  });

  it('only returns citations for chunks that are included in the bounded context', () => {
    const service = new KnowledgeContextPackService();

    const pack = service.buildContextPack({
      chunks: [
        {
          chunk: chunk('chunk-1', 'kp-1', 'A'.repeat(11_980)),
          pageTitle: 'Long KMS',
          citations: [
            { sourcePageId: 'page-1', title: 'Long KMS', url: '/p/page-1' },
          ],
        },
        {
          chunk: chunk(
            'chunk-2',
            'kp-2',
            '登记批准日期：2026年06月05日',
          ),
          pageTitle: '合合信息Chaterm',
          citations: [
            {
              sourcePageId: 'page-2',
              title: '合合信息Chaterm',
              url: '/p/page-2',
            },
          ],
        },
      ],
    });

    expect(pack.context).toContain('Long KMS');
    expect(pack.context).not.toContain('登记批准日期');
    expect(pack.citations).toEqual([
      { sourcePageId: 'page-1', title: 'Long KMS', url: '/p/page-1' },
    ]);
  });
});

function capsule(id: string, title: string, body: string) {
  return {
    id,
    workspaceId: 'workspace-1',
    spaceId: 'space-1',
    compileScope: 'space',
    title,
    slug: id,
    pageType: null,
    body,
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
    contentHash: `${id}-hash`,
    embedding: [1, 0],
    compilerRunId: 'run-1',
    compileTaskId: 'task-1',
    staleAt: null,
    createdAt: new Date('2026-06-16T00:00:00.000Z'),
  };
}
