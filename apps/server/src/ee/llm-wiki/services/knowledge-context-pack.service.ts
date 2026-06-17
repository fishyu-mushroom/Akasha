import { Injectable } from '@nestjs/common';
import { KnowledgeChunk, KnowledgePage } from '@docmost/db/types/entity.types';
import {
  KNOWLEDGE_COMPLETENESS_NOTICE,
  KnowledgeRetrievalResult,
} from './knowledge-retrieval.service';

const MAX_CONTEXT_LENGTH = 12_000;

export type KnowledgeCitation = {
  sourcePageId: string;
  title: string;
  url: string;
};

export type KnowledgeContextPackInput = {
  capsules?: Array<{
    capsule: KnowledgeRetrievalResult['capsules'][number] | KnowledgePage;
    citations?: KnowledgeCitation[];
  }>;
  chunks?: Array<{
    chunk: KnowledgeChunk;
    pageTitle: string;
    citations?: KnowledgeCitation[];
  }>;
};

export type KnowledgeContextPack = {
  context: string;
  citations: KnowledgeCitation[];
  completenessNotice: typeof KNOWLEDGE_COMPLETENESS_NOTICE;
};

@Injectable()
export class KnowledgeContextPackService {
  buildContextPack(input: KnowledgeContextPackInput): KnowledgeContextPack {
    const chunkPack = input.chunks?.length
      ? buildBoundedChunkContext(input.chunks)
      : undefined;
    const context = chunkPack?.context ?? buildBoundedContext(input.capsules ?? []);
    const citationsBySource = new Map<string, KnowledgeCitation>();
    const citationEntries = chunkPack?.includedChunks ?? input.capsules ?? [];

    for (const entry of citationEntries) {
      for (const citation of entry.citations ?? []) {
        citationsBySource.set(citation.sourcePageId, citation);
      }
    }

    return {
      context,
      citations: [...citationsBySource.values()],
      completenessNotice: KNOWLEDGE_COMPLETENESS_NOTICE,
    };
  }
}

function buildBoundedChunkContext(
  chunks: NonNullable<KnowledgeContextPackInput['chunks']>,
): {
  context: string;
  includedChunks: NonNullable<KnowledgeContextPackInput['chunks']>;
} {
  const sections: string[] = [];
  const includedChunks: NonNullable<KnowledgeContextPackInput['chunks']> = [];
  let remaining = MAX_CONTEXT_LENGTH;

  for (const entry of chunks) {
    const title = `# ${entry.pageTitle}`;
    const body = entry.chunk.text;
    const separatorLength = sections.length === 0 ? 0 : 2;
    if (remaining <= title.length + separatorLength) break;

    const bodyBudget = remaining - title.length - separatorLength - 1;
    const clippedBody = body.slice(0, Math.max(0, bodyBudget));
    const section = [title, clippedBody].join('\n');
    sections.push(section);
    includedChunks.push(entry);
    remaining -= section.length + separatorLength;
  }

  return {
    context: sections.join('\n\n').slice(0, MAX_CONTEXT_LENGTH),
    includedChunks,
  };
}

function buildBoundedContext(
  capsules: KnowledgeContextPackInput['capsules'],
): string {
  const sections: string[] = [];
  let remaining = MAX_CONTEXT_LENGTH;

  for (const { capsule } of capsules) {
    const title = `# ${capsule.title}`;
    const separatorLength = sections.length === 0 ? 0 : 2;
    if (remaining <= title.length + separatorLength) break;

    const bodyBudget = remaining - title.length - separatorLength - 1;
    const body = capsule.body.slice(0, Math.max(0, bodyBudget));
    const section = [title, body].join('\n');
    sections.push(section);
    remaining -= section.length + separatorLength;
  }

  return sections.join('\n\n').slice(0, MAX_CONTEXT_LENGTH);
}
