import { Injectable } from '@nestjs/common';
import { KnowledgeCapsuleRepo } from '@docmost/db/repos/llm-wiki/knowledge-capsule.repo';
import { PageRepo } from '@docmost/db/repos/page/page.repo';
import { KnowledgeChunk, KnowledgePage } from '@docmost/db/types/entity.types';
import { KnowledgeCitation } from './knowledge-context-pack.service';
import { KnowledgeRetrievalResult } from './knowledge-retrieval.service';
import { KnowledgeSourceAuthorizationService } from './knowledge-source-authorization.service';

type CapsuleCitationEntry = {
  capsule: KnowledgePage;
  citations: KnowledgeCitation[];
};

type ChunkCitationEntry = {
  chunk: KnowledgeChunk;
  pageTitle: string;
  citations: KnowledgeCitation[];
};

@Injectable()
export class KnowledgeCitationResolverService {
  constructor(
    private readonly capsuleRepo: KnowledgeCapsuleRepo,
    private readonly sourceAuthorization: KnowledgeSourceAuthorizationService,
    private readonly pageRepo: PageRepo,
  ) {}

  async resolveForCapsules(input: {
    workspaceId: string;
    userId: string;
    capsules: KnowledgePage[];
  }): Promise<CapsuleCitationEntry[]> {
    const readableSourceIdsByCapsule = new Map<string, string[]>();
    const allReadableSourceIds = new Set<string>();

    for (const capsule of input.capsules) {
      const sourcePageIds = await this.capsuleRepo.findDependencySourcePageIds({
        workspaceId: input.workspaceId,
        knowledgePageIds: [capsule.id],
      });
      const readableSourcePageIds =
        await this.sourceAuthorization.filterReadableSources({
          workspaceId: input.workspaceId,
          userId: input.userId,
          sourcePageIds,
        });

      readableSourceIdsByCapsule.set(capsule.id, readableSourcePageIds);
      readableSourcePageIds.forEach((sourceId) =>
        allReadableSourceIds.add(sourceId),
      );
    }

    const pagesById = await this.findReadableSourcePages(
      [...allReadableSourceIds],
      input.workspaceId,
    );

    return input.capsules.map((capsule) => ({
      capsule,
      citations: (readableSourceIdsByCapsule.get(capsule.id) ?? [])
        .map((sourcePageId) => pagesById.get(sourcePageId))
        .filter(Boolean)
        .map((page) => ({
          sourcePageId: page.id,
          title: page.title,
          url: `/p/${page.slugId}`,
      })),
    }));
  }

  async resolveForChunks(input: {
    workspaceId: string;
    chunks: KnowledgeRetrievalResult['chunks'];
  }): Promise<ChunkCitationEntry[]> {
    const allSourcePageIds = unique(
      input.chunks.flatMap((entry) => entry.sourcePageIds),
    );
    const pagesById = await this.findReadableSourcePages(
      allSourcePageIds,
      input.workspaceId,
    );

    return input.chunks.map((entry) => ({
      chunk: entry.chunk,
      pageTitle: entry.page.title,
      citations: entry.sourcePageIds
        .map((sourcePageId) => pagesById.get(sourcePageId))
        .filter(Boolean)
        .map((page) => ({
          sourcePageId: page.id,
          title: page.title,
          url: `/p/${page.slugId}`,
        })),
    }));
  }

  private async findReadableSourcePages(
    sourcePageIds: string[],
    workspaceId: string,
  ) {
    if (sourcePageIds.length === 0) {
      return new Map<
        string,
        { id: string; title: string; slugId: string }
      >();
    }

    const pages = await this.pageRepo.findManyByIds(sourcePageIds, {
      workspaceId,
    });

    return new Map(
      pages.map((page) => [
        page.id,
        { id: page.id, title: page.title, slugId: page.slugId },
      ]),
    );
  }
}

function unique(values: string[]): string[] {
  return [...new Set(values)];
}
