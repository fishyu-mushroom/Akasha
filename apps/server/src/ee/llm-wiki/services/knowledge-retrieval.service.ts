import { Injectable } from '@nestjs/common';
import { KnowledgeCapsuleRepo } from '@docmost/db/repos/llm-wiki/knowledge-capsule.repo';
import { KnowledgeChunk, KnowledgePage } from '@docmost/db/types/entity.types';
import { UserRepo } from '@docmost/db/repos/user/user.repo';
import { SpaceAuthorizationService } from '../../../core/space/services/space-authorization.service';
import {
  ConfiguredKnowledgeEmbeddingProvider,
} from './knowledge-embedding-provider.service';
import { KnowledgeRetrievalRankerService } from './knowledge-retrieval-ranker.service';
import { KnowledgeSourceAuthorizationService } from './knowledge-source-authorization.service';

export const KNOWLEDGE_COMPLETENESS_NOTICE =
  'Some knowledge may be unavailable because access is permission-scoped.';

export type KnowledgeRetrievalResult = {
  mode: 'high_completeness';
  chunks: Array<{
    chunk: KnowledgeChunk;
    page: KnowledgePage;
    sourcePageIds: string[];
  }>;
  capsules: KnowledgePage[];
  completenessNotice: typeof KNOWLEDGE_COMPLETENESS_NOTICE;
};

@Injectable()
export class KnowledgeRetrievalService {
  constructor(
    private readonly userRepo: UserRepo,
    private readonly spaceAuthorization: SpaceAuthorizationService,
    private readonly capsuleRepo: KnowledgeCapsuleRepo,
    private readonly sourceAuthorization: KnowledgeSourceAuthorizationService,
    private readonly embeddingProvider: ConfiguredKnowledgeEmbeddingProvider,
    private readonly ranker: KnowledgeRetrievalRankerService,
  ) {}

  async retrieve(input: {
    workspaceId: string;
    userId: string;
    query: string;
    spaceIds: string[];
    candidateLimit?: number;
  }): Promise<KnowledgeRetrievalResult> {
    const candidateLimit = input.candidateLimit ?? 20;
    const user = await this.userRepo.findById(input.userId, input.workspaceId);
    if (!user) {
      return emptyResult();
    }

    const readableSpaceIds =
      await this.spaceAuthorization.filterReadableSpaceIds({
        user,
        spaceIds: unique(input.spaceIds),
      });
    if (readableSpaceIds.length === 0) {
      return emptyResult();
    }

    const queryEmbedding = await this.embeddingProvider.embedQuery(input.query);
    if (!queryEmbedding) {
      return emptyResult();
    }

    const chunkCandidates = await this.capsuleRepo.findEmbeddedChunkCandidates({
      workspaceId: input.workspaceId,
      spaceIds: readableSpaceIds,
      limit: candidateLimit * 10,
    });
    const rankedChunks = this.ranker.rankChunks({
      query: input.query,
      queryEmbedding,
      chunks: chunkCandidates,
      limit: candidateLimit,
    });
    const rankedPageIds = unique(
      rankedChunks.map((chunk) => chunk.knowledgePageId),
    );
    const pages = await this.capsuleRepo.findPagesByIds({
      workspaceId: input.workspaceId,
      knowledgePageIds: rankedPageIds,
    });
    const pagesById = new Map(pages.map((page) => [page.id, page]));

    const authorizedChunks: KnowledgeRetrievalResult['chunks'] = [];
    for (const chunk of rankedChunks) {
      const page = pagesById.get(chunk.knowledgePageId);
      if (!page) continue;

      const sourcePageIds = await this.capsuleRepo.findChunkSourcePageIds({
        workspaceId: input.workspaceId,
        chunkId: chunk.id,
      });
      const readableSourcePageIds =
        await this.sourceAuthorization.filterReadableSources({
          workspaceId: input.workspaceId,
          userId: input.userId,
          sourcePageIds,
        });

      if (
        sourcePageIds.length > 0 &&
        readableSourcePageIds.length === sourcePageIds.length
      ) {
        authorizedChunks.push({
          chunk,
          page,
          sourcePageIds,
        });
      }
    }

    return {
      mode: 'high_completeness',
      chunks: authorizedChunks,
      capsules: [],
      completenessNotice: KNOWLEDGE_COMPLETENESS_NOTICE,
    };
  }
}

function emptyResult(): KnowledgeRetrievalResult {
  return {
    mode: 'high_completeness',
    chunks: [],
    capsules: [],
    completenessNotice: KNOWLEDGE_COMPLETENESS_NOTICE,
  };
}

function unique(values: string[]): string[] {
  return [...new Set(values)];
}
