import { KnowledgeCapsuleRepo } from '@docmost/db/repos/llm-wiki/knowledge-capsule.repo';
import { KnowledgeSourceRepo } from '@docmost/db/repos/llm-wiki/knowledge-source.repo';
import { KnowledgeArtifactValidatorService } from './knowledge-artifact-validator.service';
import { KnowledgeImportService } from './knowledge-import.service';
import { CompileSpaceInput } from '../types/compiler-artifact.types';

describe('KnowledgeImportService', () => {
  it('embeds imported chunks when compiler artifacts do not include embeddings', async () => {
    const artifact = {
      artifactId: 'artifact-1',
      workspaceId: 'workspace-1',
      spaceId: 'space-1',
      title: 'Compiled',
      contentMarkdown: '# Compiled',
      sourcePageIds: ['source-1'],
      compilerVersion: 'compiler@1',
      promptVersion: 'prompt@1',
      inputSourceRefs: [
        {
          workspaceId: 'workspace-1',
          spaceId: 'space-1',
          sourcePageId: 'source-1',
          sourceVersion: 'v1',
          contentHash: 'hash-1',
        },
      ],
      chunks: [{ text: 'Chaterm Flutter uses layered modules.' }],
    };
    const sourceRepo = {
      upsertPageSource: jest.fn().mockResolvedValue({ id: 'source-row-1' }),
    };
    const capsuleRepo = {
      markCompileScopeStale: jest.fn().mockResolvedValue(undefined),
      upsertCompiledArtifacts: jest
        .fn()
        .mockResolvedValue({ id: 'artifact-1' }),
    };
    const validator = {
      validateCompileResult: jest.fn().mockReturnValue({
        accepted: [artifact],
        quarantined: [],
      }),
    };
    const embeddingProvider = {
      embedQuery: jest.fn().mockResolvedValue([0.12, 0.34, 0.56]),
    };
    const service = new KnowledgeImportService(
      sourceRepo as unknown as KnowledgeSourceRepo,
      capsuleRepo as unknown as KnowledgeCapsuleRepo,
      validator as unknown as KnowledgeArtifactValidatorService,
      embeddingProvider as never,
    );

    await service.importCompileResult({
      input: compileInput(),
      artifacts: [artifact],
    });

    expect(embeddingProvider.embedQuery).toHaveBeenCalledWith(
      'Chaterm Flutter uses layered modules.',
    );
    expect(capsuleRepo.upsertCompiledArtifacts).toHaveBeenCalledWith([
      expect.objectContaining({
        chunks: [
          expect.objectContaining({
            text: 'Chaterm Flutter uses layered modules.',
            embedding: [0.12, 0.34, 0.56],
          }),
        ],
      }),
    ]);
  });

  it('imports only validator-accepted artifacts and dependencies', async () => {
    const input = compileInput();
    const artifact = {
      artifactId: 'artifact-1',
      workspaceId: 'workspace-1',
      spaceId: 'space-1',
      title: 'Compiled',
      contentMarkdown: '# Compiled',
      sourcePageIds: ['source-1'],
      compilerVersion: 'compiler@1',
      promptVersion: 'prompt@1',
      compilerRunId: 'run-1',
      compileTaskId: 'task-1',
      inputSourceRefs: [
        {
          workspaceId: 'workspace-1',
          spaceId: 'space-1',
          sourcePageId: 'source-1',
          sourceVersion: 'v1',
          contentHash: 'hash-1',
        },
      ],
      claims: [
        {
          text: 'Kafka is used for events.',
          confidence: 0.8,
        },
      ],
      chunks: [
        {
          text: 'Kafka is used for events.',
          claimIndex: 0,
        },
      ],
      links: [
        {
          linkType: 'cross_space_reference',
          targetSpaceId: 'space-2',
          linkText: 'External page',
          isOpaque: true,
        },
      ],
      graphEdges: [
        {
          toKnowledgePageId: '22222222-2222-4222-8222-222222222222',
          relation: 'depends_on',
        },
      ],
    };
    const sourceRepo = {
      upsertPageSource: jest.fn().mockResolvedValue({ id: 'source-row-1' }),
    };
    const capsuleRepo = {
      markCompileScopeStale: jest.fn().mockResolvedValue(undefined),
      upsertCompiledArtifacts: jest
        .fn()
        .mockResolvedValue({ id: 'artifact-1' }),
    };
    const validator = {
      validateCompileResult: jest.fn().mockReturnValue({
        accepted: [artifact],
        quarantined: [],
      }),
    };
    const embeddingProvider = {
      embedQuery: jest.fn().mockResolvedValue(null),
    };
    const service = new KnowledgeImportService(
      sourceRepo as unknown as KnowledgeSourceRepo,
      capsuleRepo as unknown as KnowledgeCapsuleRepo,
      validator as unknown as KnowledgeArtifactValidatorService,
      embeddingProvider as never,
    );

    await expect(
      service.importCompileResult({ input, artifacts: [artifact] }),
    ).resolves.toEqual({
      importedArtifactCount: 1,
      quarantinedArtifactCount: 0,
    });

    expect(sourceRepo.upsertPageSource).toHaveBeenCalledWith({
      workspaceId: 'workspace-1',
      sourcePageId: 'source-1',
      sourceSpaceId: 'space-1',
      sourceType: 'docmost_page',
      sourceVersion: 'v1',
      contentHash: 'hash-1',
      extractedText: 'Source body',
      mimeType: 'text/plain',
    });
    expect(capsuleRepo.markCompileScopeStale).toHaveBeenCalledWith({
      workspaceId: 'workspace-1',
      spaceId: 'space-1',
    });
    expect(
      capsuleRepo.markCompileScopeStale.mock.invocationCallOrder[0],
    ).toBeLessThan(capsuleRepo.upsertCompiledArtifacts.mock.invocationCallOrder[0]);
    expect(capsuleRepo.upsertCompiledArtifacts).toHaveBeenCalledWith([{
      page: expect.objectContaining({
        id: 'artifact-1',
        workspaceId: 'workspace-1',
        spaceId: 'space-1',
        title: 'Compiled',
        body: '# Compiled',
        compilerRunId: 'run-1',
        compileTaskId: 'task-1',
      }),
      pageSources: [
        {
          workspaceId: 'workspace-1',
          knowledgePageId: 'artifact-1',
          sourcePageId: 'source-1',
          sourceVersion: 'v1',
          sourceRange: null,
          quoteHash: null,
          contentHash: 'hash-1',
          provenanceKind: 'synthesis_lineage',
          attachmentId: null,
        },
      ],
      claims: [
        expect.objectContaining({
          workspaceId: 'workspace-1',
          spaceId: 'space-1',
          knowledgePageId: 'artifact-1',
          text: 'Kafka is used for events.',
          confidence: 0.8,
          position: 0,
          compilerRunId: 'run-1',
          compileTaskId: 'task-1',
        }),
      ],
      claimSources: [
        expect.objectContaining({
          workspaceId: 'workspace-1',
          sourcePageId: 'source-1',
          sourceVersion: 'v1',
          sourceRange: null,
          quoteHash: null,
          contentHash: 'hash-1',
          provenanceKind: 'synthesis_lineage',
          attachmentId: null,
        }),
      ],
      chunks: [
        expect.objectContaining({
          workspaceId: 'workspace-1',
          spaceId: 'space-1',
          knowledgePageId: 'artifact-1',
          text: 'Kafka is used for events.',
          contentHash: expect.stringMatching(/^sha256:/),
          embedding: null,
          compilerRunId: 'run-1',
          compileTaskId: 'task-1',
        }),
      ],
      chunkSources: [
        expect.objectContaining({
          workspaceId: 'workspace-1',
          sourcePageId: 'source-1',
          sourceVersion: 'v1',
          sourceRange: null,
          quoteHash: null,
          contentHash: 'hash-1',
          provenanceKind: 'synthesis_lineage',
          attachmentId: null,
        }),
      ],
      links: [
        expect.objectContaining({
          workspaceId: 'workspace-1',
          spaceId: 'space-1',
          fromKnowledgePageId: 'artifact-1',
          toKnowledgePageId: null,
          targetPageId: null,
          targetSpaceId: 'space-2',
          linkText: 'External page',
          linkType: 'cross_space_reference',
          isDangling: true,
          compilerRunId: 'run-1',
          compileTaskId: 'task-1',
        }),
      ],
      linkSources: [
        expect.objectContaining({
          workspaceId: 'workspace-1',
          sourcePageId: 'source-1',
          sourceVersion: 'v1',
          sourceRange: null,
          quoteHash: null,
          contentHash: 'hash-1',
          provenanceKind: 'synthesis_lineage',
          attachmentId: null,
        }),
      ],
      graphEdges: [
        expect.objectContaining({
          workspaceId: 'workspace-1',
          spaceId: 'space-1',
          fromKnowledgePageId: 'artifact-1',
          toKnowledgePageId: '22222222-2222-4222-8222-222222222222',
          relation: 'depends_on',
          compilerRunId: 'run-1',
          compileTaskId: 'task-1',
        }),
      ],
      graphEdgeSources: [
        expect.objectContaining({
          workspaceId: 'workspace-1',
          sourcePageId: 'source-1',
          sourceVersion: 'v1',
          sourceRange: null,
          quoteHash: null,
          contentHash: 'hash-1',
          provenanceKind: 'synthesis_lineage',
          attachmentId: null,
        }),
      ],
    }]);
  });

  it('does not import quarantined artifacts', async () => {
    const sourceRepo = {
      upsertPageSource: jest.fn(),
    };
    const capsuleRepo = {
      markCompileScopeStale: jest.fn(),
      upsertCompiledArtifacts: jest.fn(),
    };
    const validator = {
      validateCompileResult: jest.fn().mockReturnValue({
        accepted: [],
        quarantined: [{ artifact: {}, reasons: ['bad'] }],
      }),
    };
    const embeddingProvider = {
      embedQuery: jest.fn(),
    };
    const service = new KnowledgeImportService(
      sourceRepo as unknown as KnowledgeSourceRepo,
      capsuleRepo as unknown as KnowledgeCapsuleRepo,
      validator as unknown as KnowledgeArtifactValidatorService,
      embeddingProvider as never,
    );

    await expect(
      service.importCompileResult({ input: compileInput(), artifacts: [] }),
    ).resolves.toEqual({
      importedArtifactCount: 0,
      quarantinedArtifactCount: 1,
    });

    expect(capsuleRepo.upsertCompiledArtifacts).not.toHaveBeenCalled();
    expect(capsuleRepo.markCompileScopeStale).not.toHaveBeenCalled();
  });
});

function compileInput(): CompileSpaceInput {
  return {
    workspaceId: 'workspace-1',
    spaceId: 'space-1',
    compilerVersion: 'compiler@1',
    promptVersion: 'prompt@1',
    sources: [
      {
        workspaceId: 'workspace-1',
        spaceId: 'space-1',
        sourcePageId: 'source-1',
        sourceVersion: 'v1',
        contentHash: 'hash-1',
        title: 'Source',
        text: 'Source body',
        references: [],
      },
    ],
  };
}
