import { Injectable } from '@nestjs/common';
import {
  CompiledKnowledgeArtifact,
  CompileSpaceInput,
} from '../types/compiler-artifact.types';
import { KnowledgeSourceRef } from '../types/knowledge.types';

export interface QuarantinedKnowledgeArtifact {
  artifact: CompiledKnowledgeArtifact;
  reasons: string[];
}

export interface KnowledgeArtifactValidationResult {
  accepted: CompiledKnowledgeArtifact[];
  quarantined: QuarantinedKnowledgeArtifact[];
}

@Injectable()
export class KnowledgeArtifactValidatorService {
  validateCompileResult(input: {
    input: CompileSpaceInput;
    artifacts: CompiledKnowledgeArtifact[];
  }): KnowledgeArtifactValidationResult {
    const accepted: CompiledKnowledgeArtifact[] = [];
    const quarantined: QuarantinedKnowledgeArtifact[] = [];
    const compileSourceKeys = new Set(
      input.input.sources.map((source) =>
        sourceKey(source.sourcePageId, source.sourceVersion, source.contentHash),
      ),
    );

    for (const artifact of input.artifacts) {
      const reasons = this.validateArtifact(
        input.input,
        artifact,
        compileSourceKeys,
      );
      if (reasons.length > 0) {
        quarantined.push({ artifact, reasons });
      } else {
        accepted.push(artifact);
      }
    }

    return { accepted, quarantined };
  }

  private validateArtifact(
    input: CompileSpaceInput,
    artifact: CompiledKnowledgeArtifact,
    compileSourceKeys: Set<string>,
  ): string[] {
    const reasons: string[] = [];

    if (
      artifact.workspaceId !== input.workspaceId ||
      artifact.spaceId !== input.spaceId
    ) {
      reasons.push('artifact scope does not match compile scope');
    }

    if (!isUuid(artifact.artifactId)) {
      reasons.push('artifact id must be a UUID');
    }

    if (
      !artifact.compilerRunId ||
      !artifact.compileTaskId ||
      !artifact.inputSourceRefs?.length
    ) {
      reasons.push('synthesis lineage is incomplete');
    }

    const hasInvalidSourceRef = hasSourceOutsideCompileInput(
      artifact.inputSourceRefs ?? [],
      input,
      compileSourceKeys,
    );
    if (hasInvalidSourceRef) {
      reasons.push('artifact source is not in compile input');
    }

    if (
      artifact.inputSourceRefs?.length &&
      !hasInvalidSourceRef &&
      !sameStringSet(
        artifact.sourcePageIds,
        artifact.inputSourceRefs.map((source) => source.sourcePageId),
      )
    ) {
      reasons.push('artifact source page ids must match synthesis lineage');
    }

    if (
      (artifact.claims ?? []).some((claim) =>
        hasSourceOutsideCompileInput(
          claim.inputSourceRefs ?? [],
          input,
          compileSourceKeys,
        ),
      )
    ) {
      reasons.push('claim source is not in compile input');
    }

    if (
      (artifact.chunks ?? []).some((chunk) =>
        hasSourceOutsideCompileInput(
          chunk.inputSourceRefs ?? [],
          input,
          compileSourceKeys,
        ),
      )
    ) {
      reasons.push('chunk source is not in compile input');
    }

    for (const link of artifact.links ?? []) {
      if (
        link.linkType === 'cross_space_reference' &&
        link.targetSpaceId !== input.spaceId &&
        link.isOpaque !== true
      ) {
        reasons.push('cross-space references must be opaque');
        break;
      }
    }

    if (
      (artifact.links ?? []).some((link) =>
        hasSourceOutsideCompileInput(
          link.inputSourceRefs ?? [],
          input,
          compileSourceKeys,
        ),
      )
    ) {
      reasons.push('link source is not in compile input');
    }

    if (
      (artifact.graphEdges ?? []).some(
        (edge) => !isUuid(edge.toKnowledgePageId),
      )
    ) {
      reasons.push('graph edge target id must be a UUID');
    }

    if (
      (artifact.graphEdges ?? []).some((edge) =>
        hasSourceOutsideCompileInput(
          edge.inputSourceRefs ?? [],
          input,
          compileSourceKeys,
        ),
      )
    ) {
      reasons.push('graph edge source is not in compile input');
    }

    return reasons;
  }
}

function hasSourceOutsideCompileInput(
  sources: KnowledgeSourceRef[],
  input: CompileSpaceInput,
  compileSourceKeys: Set<string>,
): boolean {
  return sources.some(
    (source) =>
      source.workspaceId !== input.workspaceId ||
      source.spaceId !== input.spaceId ||
      !compileSourceKeys.has(
        sourceKey(source.sourcePageId, source.sourceVersion, source.contentHash),
      ),
  );
}

function sameStringSet(a: string[], b: string[]): boolean {
  const left = new Set(a);
  const right = new Set(b);

  if (left.size !== right.size) return false;

  for (const value of left) {
    if (!right.has(value)) return false;
  }

  return true;
}

function isUuid(value: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
    value,
  );
}

function sourceKey(
  sourcePageId: string,
  sourceVersion: string,
  contentHash: string,
): string {
  return `${sourcePageId}:${sourceVersion}:${contentHash}`;
}
