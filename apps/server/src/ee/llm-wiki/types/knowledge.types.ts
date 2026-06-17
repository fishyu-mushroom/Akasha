export interface KnowledgeScope {
  workspaceId: string;
  spaceId: string;
}

export interface KnowledgeSourceRef extends KnowledgeScope {
  sourcePageId: string;
  sourceVersion: string;
  contentHash: string;
}
