import type {
  KnowledgeCompileResult,
  KnowledgeDiagnosticsResult,
  KnowledgeGraphResult,
  KnowledgeQueryResult,
} from "../types/knowledge.types";

export async function queryKnowledge(params: {
  query: string;
  spaceIds: string[];
  chatContext?: string[];
}): Promise<KnowledgeQueryResult> {
  const response = await fetch("/api/llm-wiki/query", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    credentials: "include",
    body: JSON.stringify(params),
  });

  if (!response.ok) {
    const message = await readErrorMessage(response);
    throw new Error(message);
  }

  return normalizeKnowledgeQueryResult(unwrapApiData(await response.json()));
}

export async function compileKnowledgeSpaces(params: {
  spaceIds: string[];
}): Promise<KnowledgeCompileResult> {
  const response = await fetch("/api/llm-wiki/admin/compile-spaces", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    credentials: "include",
    body: JSON.stringify(params),
  });

  if (!response.ok) {
    const message = await readErrorMessage(response);
    throw new Error(message);
  }

  const body = unwrapApiData(await response.json());
  const record = isRecord(body) ? body : {};
  return {
    queuedSpaceCount:
      typeof record.queuedSpaceCount === "number" ? record.queuedSpaceCount : 0,
  };
}

export async function getKnowledgeDiagnostics(params: {
  spaceIds?: string[];
  limit?: number;
}): Promise<KnowledgeDiagnosticsResult> {
  const response = await fetch("/api/llm-wiki/admin/diagnostics", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    credentials: "include",
    body: JSON.stringify(params),
  });

  if (!response.ok) {
    const message = await readErrorMessage(response);
    throw new Error(message);
  }

  return normalizeKnowledgeDiagnostics(unwrapApiData(await response.json()));
}

export async function getKnowledgeGraph(params: {
  spaceId: string;
  limit?: number;
}): Promise<KnowledgeGraphResult> {
  const searchParams = new URLSearchParams({ spaceId: params.spaceId });
  if (params.limit) {
    searchParams.set("limit", String(params.limit));
  }

  const response = await fetch(`/api/llm-wiki/graph?${searchParams.toString()}`, {
    method: "GET",
    credentials: "include",
  });

  if (!response.ok) {
    const message = await readErrorMessage(response);
    throw new Error(message);
  }

  return normalizeKnowledgeGraph(unwrapApiData(await response.json()));
}

function normalizeKnowledgeQueryResult(value: unknown): KnowledgeQueryResult {
  const record = isRecord(value) ? value : {};
  const citations = Array.isArray(record.citations) ? record.citations : [];

  return {
    answer: typeof record.answer === "string" ? record.answer : "",
    citations: citations
      .filter(isRecord)
      .map((citation) => ({
        sourcePageId:
          typeof citation.sourcePageId === "string" ? citation.sourcePageId : "",
        title: typeof citation.title === "string" ? citation.title : "",
        url: typeof citation.url === "string" ? citation.url : "#",
      }))
      .filter((citation) => citation.sourcePageId || citation.title),
    completenessNotice:
      typeof record.completenessNotice === "string"
        ? record.completenessNotice
        : undefined,
  };
}

function normalizeKnowledgeDiagnostics(value: unknown): KnowledgeDiagnosticsResult {
  const record = isRecord(value) ? value : {};
  const pages = Array.isArray(record.pages) ? record.pages : [];
  const jobs = Array.isArray(record.jobs) ? record.jobs : [];

  return {
    pages: pages.filter(isRecord).map((page) => ({
      pageId: readString(page.pageId),
      slugId: readString(page.slugId),
      title: readString(page.title),
      spaceId: readString(page.spaceId),
      spaceName: readString(page.spaceName),
      spaceSlug: readString(page.spaceSlug),
      updatedAt: readString(page.updatedAt),
      deletedAt: typeof page.deletedAt === "string" ? page.deletedAt : null,
      textLength: readNumber(page.textLength),
      knowledgeSourceCount: readNumber(page.knowledgeSourceCount),
      staleSourceCount: readNumber(page.staleSourceCount),
      knowledgePageSourceCount: readNumber(page.knowledgePageSourceCount),
      knowledgeChunkCount: readNumber(page.knowledgeChunkCount),
    })),
    jobs: jobs.filter(isRecord).map((job) => ({
      id: readString(job.id),
      name: readString(job.name),
      state: readString(job.state),
      workspaceId:
        typeof job.workspaceId === "string" ? job.workspaceId : undefined,
      spaceId: typeof job.spaceId === "string" ? job.spaceId : undefined,
      pageIds: Array.isArray(job.pageIds)
        ? job.pageIds.filter((pageId): pageId is string => typeof pageId === "string")
        : [],
      timestamp: readOptionalNumber(job.timestamp),
      processedOn: readOptionalNumber(job.processedOn),
      finishedOn: readOptionalNumber(job.finishedOn),
      failedReason:
        typeof job.failedReason === "string" ? job.failedReason : undefined,
    })),
  };
}

function normalizeKnowledgeGraph(value: unknown): KnowledgeGraphResult {
  const record = isRecord(value) ? value : {};
  const nodes = Array.isArray(record.nodes) ? record.nodes : [];
  const edges = Array.isArray(record.edges) ? record.edges : [];

  return {
    nodes: nodes
      .filter(isRecord)
      .map((node) => ({
        id: readString(node.id),
        title: readString(node.title),
        spaceId: readString(node.spaceId),
        sourcePageId:
          typeof node.sourcePageId === "string" ? node.sourcePageId : undefined,
        degree: readNumber(node.degree),
      }))
      .filter((node) => node.id),
    edges: edges
      .filter(isRecord)
      .map((edge) => ({
        id: readString(edge.id),
        from: readString(edge.from),
        to: readString(edge.to),
        type: (edge.type === "semantic" ? "semantic" : "link") as
          | "semantic"
          | "link",
        label: readString(edge.label),
      }))
      .filter((edge) => edge.id && edge.from && edge.to),
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function unwrapApiData(value: unknown): unknown {
  if (!isRecord(value)) {
    return value;
  }

  return "data" in value ? value.data : value;
}

function readString(value: unknown): string {
  return typeof value === "string" ? value : "";
}

function readNumber(value: unknown): number {
  return typeof value === "number" ? value : 0;
}

function readOptionalNumber(value: unknown): number | undefined {
  return typeof value === "number" ? value : undefined;
}

async function readErrorMessage(response: Response): Promise<string> {
  const fallback = `HTTP error ${response.status}`;

  try {
    const body = await response.json();
    if (body?.message) {
      return Array.isArray(body.message) ? body.message.join(", ") : body.message;
    }
  } catch {
    return fallback;
  }

  return fallback;
}
