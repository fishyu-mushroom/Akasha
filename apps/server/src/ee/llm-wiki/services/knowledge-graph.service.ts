import { Injectable } from '@nestjs/common';
import { KnowledgeCapsuleRepo } from '@docmost/db/repos/llm-wiki/knowledge-capsule.repo';
import { UserRepo } from '@docmost/db/repos/user/user.repo';
import { SpaceAuthorizationService } from '../../../core/space/services/space-authorization.service';
import { KnowledgeSourceAuthorizationService } from './knowledge-source-authorization.service';

export type KnowledgeGraphResult = {
  nodes: KnowledgeGraphNode[];
  edges: KnowledgeGraphEdge[];
};

export type KnowledgeGraphNode = {
  id: string;
  title: string;
  spaceId: string;
  sourcePageId?: string;
  degree: number;
};

export type KnowledgeGraphEdge = {
  id: string;
  from: string;
  to: string;
  type: 'link' | 'semantic';
  label: string;
};

const DEFAULT_GRAPH_NODE_LIMIT = 300;
const MAX_GRAPH_NODE_LIMIT = 500;

@Injectable()
export class KnowledgeGraphService {
  constructor(
    private readonly userRepo: UserRepo,
    private readonly spaceAuthorization: SpaceAuthorizationService,
    private readonly capsuleRepo: KnowledgeCapsuleRepo,
    private readonly sourceAuthorization: KnowledgeSourceAuthorizationService,
  ) {}

  async getSpaceGraph(input: {
    workspaceId: string;
    userId: string;
    spaceId: string;
    limit?: number;
  }): Promise<KnowledgeGraphResult> {
    const user = await this.userRepo.findById(input.userId, input.workspaceId);
    if (!user) {
      return emptyGraph();
    }

    const readableSpaceIds =
      await this.spaceAuthorization.filterReadableSpaceIds({
        user,
        spaceIds: [input.spaceId],
      });
    if (!readableSpaceIds.includes(input.spaceId)) {
      return emptyGraph();
    }

    const graph = await this.capsuleRepo.findGraphCandidatesForSpace({
      workspaceId: input.workspaceId,
      spaceId: input.spaceId,
      limit: clampLimit(input.limit),
    });

    const allSourcePageIds = unique([
      ...graph.pageSources.map((source) => source.sourcePageId),
      ...graph.linkSources.map((source) => source.sourcePageId),
      ...graph.graphEdgeSources.map((source) => source.sourcePageId),
    ]);
    const readableSourcePageIds =
      await this.sourceAuthorization.filterReadableSources({
        workspaceId: input.workspaceId,
        userId: input.userId,
        sourcePageIds: allSourcePageIds,
      });
    const readableSourceSet = new Set(readableSourcePageIds);

    const pageSourcesByPageId = groupBy(
      graph.pageSources,
      (source) => source.knowledgePageId,
    );
    const visiblePages = graph.pages.filter((page) =>
      allSourcesReadable(pageSourcesByPageId.get(page.id) ?? [], readableSourceSet),
    );
    const visiblePageIds = new Set(visiblePages.map((page) => page.id));

    const linkSourcesByLinkId = groupBy(
      graph.linkSources,
      (source) => source.linkId,
    );
    const linkEdges = graph.links
      .filter((link) => link.toKnowledgePageId)
      .filter(
        (link) =>
          visiblePageIds.has(link.fromKnowledgePageId) &&
          visiblePageIds.has(link.toKnowledgePageId as string) &&
          allSourcesReadable(
            linkSourcesByLinkId.get(link.id) ?? [],
            readableSourceSet,
          ),
      )
      .map((link) => ({
        id: link.id,
        from: link.fromKnowledgePageId,
        to: link.toKnowledgePageId as string,
        type: 'link' as const,
        label: link.linkText || link.linkType,
      }));

    const graphEdgeSourcesByEdgeId = groupBy(
      graph.graphEdgeSources,
      (source) => source.graphEdgeId,
    );
    const semanticEdges = graph.graphEdges
      .filter(
        (edge) =>
          visiblePageIds.has(edge.fromKnowledgePageId) &&
          visiblePageIds.has(edge.toKnowledgePageId) &&
          allSourcesReadable(
            graphEdgeSourcesByEdgeId.get(edge.id) ?? [],
            readableSourceSet,
          ),
      )
      .map((edge) => ({
        id: edge.id,
        from: edge.fromKnowledgePageId,
        to: edge.toKnowledgePageId,
        type: 'semantic' as const,
        label: edge.relation,
      }));

    const edges = [...linkEdges, ...semanticEdges];
    const degreeByPageId = new Map<string, number>();
    for (const edge of edges) {
      degreeByPageId.set(edge.from, (degreeByPageId.get(edge.from) ?? 0) + 1);
      degreeByPageId.set(edge.to, (degreeByPageId.get(edge.to) ?? 0) + 1);
    }

    return {
      nodes: visiblePages.map((page) => ({
        id: page.id,
        title: page.title,
        spaceId: page.spaceId,
        sourcePageId: singleSourcePageId(pageSourcesByPageId.get(page.id) ?? []),
        degree: degreeByPageId.get(page.id) ?? 0,
      })),
      edges,
    };
  }
}

function emptyGraph(): KnowledgeGraphResult {
  return { nodes: [], edges: [] };
}

function clampLimit(limit?: number): number {
  if (!limit || limit <= 0) {
    return DEFAULT_GRAPH_NODE_LIMIT;
  }

  return Math.min(limit, MAX_GRAPH_NODE_LIMIT);
}

function allSourcesReadable<T extends { sourcePageId: string }>(
  sources: T[],
  readableSourceSet: Set<string>,
): boolean {
  return (
    sources.length > 0 &&
    sources.every((source) => readableSourceSet.has(source.sourcePageId))
  );
}

function singleSourcePageId<T extends { sourcePageId: string }>(
  sources: T[],
): string | undefined {
  const sourcePageIds = unique(sources.map((source) => source.sourcePageId));
  return sourcePageIds.length === 1 ? sourcePageIds[0] : undefined;
}

function unique(values: string[]): string[] {
  return [...new Set(values)];
}

function groupBy<T>(
  values: T[],
  keyOf: (value: T) => string,
): Map<string, T[]> {
  const grouped = new Map<string, T[]>();
  for (const value of values) {
    const key = keyOf(value);
    const group = grouped.get(key) ?? [];
    group.push(value);
    grouped.set(key, group);
  }
  return grouped;
}
