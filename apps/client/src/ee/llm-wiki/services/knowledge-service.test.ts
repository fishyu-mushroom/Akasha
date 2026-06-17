import { afterEach, describe, expect, it, vi } from "vitest";
import {
  compileKnowledgeSpaces,
  getKnowledgeGraph,
  getKnowledgeDiagnostics,
  queryKnowledge,
} from "./knowledge-service";

describe("queryKnowledge", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("normalizes missing citations to an empty list", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({ answer: "No matching knowledge." }),
      }),
    );

    await expect(
      queryKnowledge({ query: "Chaterm Flutter 的项目架构", spaceIds: ["space-1"] }),
    ).resolves.toEqual({
      answer: "No matching knowledge.",
      citations: [],
      completenessNotice: undefined,
    });
  });

  it("unwraps API envelope for query results", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({
          data: {
            answer: "Chaterm Flutter uses feature modules.",
            citations: [{ sourcePageId: "page-1", title: "项目架构", url: "/p/page-1" }],
          },
          success: true,
          status: 200,
        }),
      }),
    );

    await expect(
      queryKnowledge({ query: "Chaterm Flutter 的项目架构", spaceIds: ["space-1"] }),
    ).resolves.toEqual({
      answer: "Chaterm Flutter uses feature modules.",
      citations: [{ sourcePageId: "page-1", title: "项目架构", url: "/p/page-1" }],
      completenessNotice: undefined,
    });
  });

  it("queues selected spaces for compilation", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ queuedSpaceCount: 2 }),
    });
    vi.stubGlobal("fetch", fetchMock);

    await expect(
      compileKnowledgeSpaces({ spaceIds: ["space-1", "space-2"] }),
    ).resolves.toEqual({ queuedSpaceCount: 2 });

    expect(fetchMock).toHaveBeenCalledWith(
      "/api/llm-wiki/admin/compile-spaces",
      expect.objectContaining({
        method: "POST",
        credentials: "include",
        body: JSON.stringify({ spaceIds: ["space-1", "space-2"] }),
      }),
    );
  });

  it("unwraps API envelope for compilation results", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({
          data: { queuedSpaceCount: 1 },
          success: true,
          status: 200,
        }),
      }),
    );

    await expect(
      compileKnowledgeSpaces({ spaceIds: ["space-1"] }),
    ).resolves.toEqual({ queuedSpaceCount: 1 });
  });

  it("loads admin diagnostics and normalizes missing arrays", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        data: {
          pages: [
            {
              pageId: "page-1",
              title: "Chaterm",
              spaceName: "AIM",
              knowledgeChunkCount: 3,
            },
          ],
        },
      }),
    });
    vi.stubGlobal("fetch", fetchMock);

    await expect(
      getKnowledgeDiagnostics({ spaceIds: ["space-1"], limit: 20 }),
    ).resolves.toEqual({
      pages: [
        {
          pageId: "page-1",
          slugId: "",
          title: "Chaterm",
          spaceId: "",
          spaceName: "AIM",
          spaceSlug: "",
          updatedAt: "",
          deletedAt: null,
          textLength: 0,
          knowledgeSourceCount: 0,
          staleSourceCount: 0,
          knowledgePageSourceCount: 0,
          knowledgeChunkCount: 3,
        },
      ],
      jobs: [],
    });

    expect(fetchMock).toHaveBeenCalledWith(
      "/api/llm-wiki/admin/diagnostics",
      expect.objectContaining({
        method: "POST",
        credentials: "include",
        body: JSON.stringify({ spaceIds: ["space-1"], limit: 20 }),
      }),
    );
  });

  it("loads a space knowledge graph and normalizes nodes and edges", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        data: {
          nodes: [
            {
              id: "kp-1",
              title: "Kafka",
              spaceId: "space-1",
              sourcePageId: "page-1",
              degree: 2,
            },
          ],
          edges: [
            {
              id: "edge-1",
              from: "kp-1",
              to: "kp-2",
              type: "semantic",
              label: "depends on",
            },
          ],
        },
      }),
    });
    vi.stubGlobal("fetch", fetchMock);

    await expect(
      getKnowledgeGraph({ spaceId: "space-1", limit: 200 }),
    ).resolves.toEqual({
      nodes: [
        {
          id: "kp-1",
          title: "Kafka",
          spaceId: "space-1",
          sourcePageId: "page-1",
          degree: 2,
        },
      ],
      edges: [
        {
          id: "edge-1",
          from: "kp-1",
          to: "kp-2",
          type: "semantic",
          label: "depends on",
        },
      ],
    });

    expect(fetchMock).toHaveBeenCalledWith(
      "/api/llm-wiki/graph?spaceId=space-1&limit=200",
      expect.objectContaining({
        method: "GET",
        credentials: "include",
      }),
    );
  });
});
