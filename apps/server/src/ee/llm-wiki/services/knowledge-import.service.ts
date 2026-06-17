import { Injectable } from '@nestjs/common';
import { createHash } from 'crypto';
import {
  KnowledgeCapsuleRepo,
  UpsertCompiledArtifactInput,
} from '@docmost/db/repos/llm-wiki/knowledge-capsule.repo';
import { KnowledgeSourceRepo } from '@docmost/db/repos/llm-wiki/knowledge-source.repo';
import {
  CompiledKnowledgeArtifact,
  CompileSpaceInput,
} from '../types/compiler-artifact.types';
import { KnowledgeArtifactValidatorService } from './knowledge-artifact-validator.service';
import {
  ConfiguredKnowledgeEmbeddingProvider,
} from './knowledge-embedding-provider.service';

export interface KnowledgeImportResult {
  importedArtifactCount: number;
  quarantinedArtifactCount: number;
}

@Injectable()
export class KnowledgeImportService {
  constructor(
    private readonly sourceRepo: KnowledgeSourceRepo,
    private readonly capsuleRepo: KnowledgeCapsuleRepo,
    private readonly validator: KnowledgeArtifactValidatorService,
    private readonly embeddingProvider: ConfiguredKnowledgeEmbeddingProvider,
  ) {}

  async importCompileResult(input: {
    input: CompileSpaceInput;
    artifacts: CompiledKnowledgeArtifact[];
  }): Promise<KnowledgeImportResult> {
    const validation = this.validator.validateCompileResult(input);

    for (const source of input.input.sources) {
      await this.sourceRepo.upsertPageSource({
        workspaceId: source.workspaceId,
        sourcePageId: source.sourcePageId,
        sourceSpaceId: source.spaceId,
        sourceType: 'docmost_page',
        sourceVersion: source.sourceVersion,
        contentHash: source.contentHash,
        extractedText: source.text,
        mimeType: 'text/plain',
      });
    }

    if (validation.accepted.length > 0) {
      await this.capsuleRepo.markCompileScopeStale({
        workspaceId: input.input.workspaceId,
        spaceId: input.input.spaceId,
      });
    }

    const artifactInputs: UpsertCompiledArtifactInput[] = [];

    for (const artifact of validation.accepted) {
      const artifactChunks = await Promise.all(
        (artifact.chunks ?? []).map(async (chunk) => ({
          ...chunk,
          embedding:
            chunk.embedding ?? (await this.embeddingProvider.embedQuery(chunk.text)),
        })),
      );
      const claims = (artifact.claims ?? []).map((claim, index) => ({
        id: stableUuid(`${artifact.artifactId}:claim:${index}`),
        workspaceId: artifact.workspaceId,
        spaceId: artifact.spaceId,
        knowledgePageId: artifact.artifactId,
        text: claim.text,
        confidence: claim.confidence ?? null,
        position: index,
        compilerRunId: artifact.compilerRunId ?? null,
        compileTaskId: artifact.compileTaskId ?? null,
        staleAt: null,
      }));
      const claimSources = claims.flatMap((claim, index) =>
        (artifact.claims?.[index]?.inputSourceRefs ??
          artifact.inputSourceRefs ??
          []).map((source) => ({
            workspaceId: artifact.workspaceId,
            claimId: claim.id,
            sourcePageId: source.sourcePageId,
            sourceVersion: source.sourceVersion,
            sourceRange: null,
            quoteHash: null,
            contentHash: source.contentHash,
            provenanceKind: 'synthesis_lineage',
            attachmentId: null,
          })),
      );
      const chunks = artifactChunks.map((chunk, index) => ({
        id: stableUuid(`${artifact.artifactId}:chunk:${index}`),
        workspaceId: artifact.workspaceId,
        spaceId: artifact.spaceId,
        knowledgePageId: artifact.artifactId,
        claimId:
          chunk.claimIndex !== undefined && chunk.claimIndex !== null
            ? claims[chunk.claimIndex]?.id ?? null
            : null,
        text: chunk.text,
        contentHash: chunk.contentHash ?? hashContent(chunk.text),
        embedding: chunk.embedding ?? null,
        compilerRunId: artifact.compilerRunId ?? null,
        compileTaskId: artifact.compileTaskId ?? null,
        staleAt: null,
      }));
      const chunkSources = chunks.flatMap((chunk, index) =>
        (artifact.chunks?.[index]?.inputSourceRefs ??
          artifact.inputSourceRefs ??
          []).map((source) => ({
            workspaceId: artifact.workspaceId,
            chunkId: chunk.id,
            sourcePageId: source.sourcePageId,
            sourceVersion: source.sourceVersion,
            sourceRange: null,
            quoteHash: null,
            contentHash: source.contentHash,
            provenanceKind: 'synthesis_lineage',
            attachmentId: null,
          })),
      );
      const links = (artifact.links ?? []).map((link, index) => {
        const linkId = stableUuid(`${artifact.artifactId}:link:${index}`);

        return {
          id: linkId,
          workspaceId: artifact.workspaceId,
          spaceId: artifact.spaceId,
          fromKnowledgePageId: artifact.artifactId,
          toKnowledgePageId: link.toKnowledgePageId ?? null,
          targetPageId: link.targetPageId ?? null,
          targetSpaceId: link.targetSpaceId ?? null,
          linkText: link.linkText ?? '',
          linkType: link.linkType,
          isDangling:
            link.isDangling ??
            (link.isOpaque === true || !link.toKnowledgePageId),
          compilerRunId: artifact.compilerRunId ?? null,
          compileTaskId: artifact.compileTaskId ?? null,
          staleAt: null,
        };
      });
      const linkSources = links.flatMap((link, index) =>
        (artifact.links?.[index]?.inputSourceRefs ??
          artifact.inputSourceRefs ??
          []).map((source) => ({
            workspaceId: artifact.workspaceId,
            linkId: link.id,
            sourcePageId: source.sourcePageId,
            sourceVersion: source.sourceVersion,
            sourceRange: null,
            quoteHash: null,
            contentHash: source.contentHash,
            provenanceKind: 'synthesis_lineage',
            attachmentId: null,
          })),
      );
      const graphEdges = (artifact.graphEdges ?? []).map((edge, index) => ({
        id: stableUuid(`${artifact.artifactId}:graph-edge:${index}`),
        workspaceId: artifact.workspaceId,
        spaceId: artifact.spaceId,
        fromKnowledgePageId: artifact.artifactId,
        toKnowledgePageId: edge.toKnowledgePageId,
        relation: edge.relation,
        compilerRunId: artifact.compilerRunId ?? null,
        compileTaskId: artifact.compileTaskId ?? null,
        staleAt: null,
      }));
      const graphEdgeSources = graphEdges.flatMap((edge, index) =>
        (artifact.graphEdges?.[index]?.inputSourceRefs ??
          artifact.inputSourceRefs ??
          []).map((source) => ({
            workspaceId: artifact.workspaceId,
            graphEdgeId: edge.id,
            sourcePageId: source.sourcePageId,
            sourceVersion: source.sourceVersion,
            sourceRange: null,
            quoteHash: null,
            contentHash: source.contentHash,
            provenanceKind: 'synthesis_lineage',
            attachmentId: null,
          })),
      );

      artifactInputs.push({
        page: {
          id: artifact.artifactId,
          workspaceId: artifact.workspaceId,
          spaceId: artifact.spaceId,
          compileScope: 'space',
          title: artifact.title,
          slug: artifact.artifactId,
          body: artifact.contentMarkdown,
          summary: null,
          pageType: null,
          compiledAt: new Date(),
          compilerVersion: artifact.compilerVersion,
          compilerRunId: artifact.compilerRunId ?? null,
          compileTaskId: artifact.compileTaskId ?? null,
          staleAt: null,
        },
        pageSources: (artifact.inputSourceRefs ?? []).map((source) => ({
          workspaceId: artifact.workspaceId,
          knowledgePageId: artifact.artifactId,
          sourcePageId: source.sourcePageId,
          sourceVersion: source.sourceVersion,
          sourceRange: null,
          quoteHash: null,
          contentHash: source.contentHash,
          provenanceKind: 'synthesis_lineage',
          attachmentId: null,
        })),
        claims,
        claimSources,
        chunks,
        chunkSources,
        links,
        linkSources,
        graphEdges,
        graphEdgeSources,
      });
    }

    if (artifactInputs.length > 0) {
      await this.capsuleRepo.upsertCompiledArtifacts(artifactInputs);
    }

    return {
      importedArtifactCount: validation.accepted.length,
      quarantinedArtifactCount: validation.quarantined.length,
    };
  }
}

function hashContent(content: string): string {
  return `sha256:${createHash('sha256').update(content).digest('hex')}`;
}

function stableUuid(input: string): string {
  const hash = createHash('sha256').update(input).digest('hex');
  return [
    hash.slice(0, 8),
    hash.slice(8, 12),
    `4${hash.slice(13, 16)}`,
    ((parseInt(hash.slice(16, 18), 16) & 0x3f) | 0x80).toString(16) +
      hash.slice(18, 20),
    hash.slice(20, 32),
  ].join('-');
}
