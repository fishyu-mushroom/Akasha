export interface KnowledgeCitation {
  sourcePageId: string;
  title: string;
  url: string;
}

export interface KnowledgeQueryResult {
  answer: string;
  citations: KnowledgeCitation[];
  completenessNotice?: string;
}

export interface KnowledgeCompileResult {
  queuedSpaceCount: number;
}

export interface KnowledgeDiagnosticsPage {
  pageId: string;
  slugId: string;
  title: string;
  spaceId: string;
  spaceName: string;
  spaceSlug: string;
  updatedAt: string;
  deletedAt: string | null;
  textLength: number;
  knowledgeSourceCount: number;
  staleSourceCount: number;
  knowledgePageSourceCount: number;
  knowledgeChunkCount: number;
}

export interface KnowledgeDiagnosticsJob {
  id: string;
  name: string;
  state: string;
  workspaceId?: string;
  spaceId?: string;
  pageIds: string[];
  timestamp?: number;
  processedOn?: number;
  finishedOn?: number;
  failedReason?: string;
}

export interface KnowledgeDiagnosticsResult {
  pages: KnowledgeDiagnosticsPage[];
  jobs: KnowledgeDiagnosticsJob[];
}

export interface KnowledgeGraphNode {
  id: string;
  title: string;
  spaceId: string;
  sourcePageId?: string;
  degree: number;
}

export interface KnowledgeGraphEdge {
  id: string;
  from: string;
  to: string;
  type: "link" | "semantic";
  label: string;
}

export interface KnowledgeGraphResult {
  nodes: KnowledgeGraphNode[];
  edges: KnowledgeGraphEdge[];
}
