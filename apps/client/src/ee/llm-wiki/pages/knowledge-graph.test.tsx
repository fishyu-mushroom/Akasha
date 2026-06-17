import { MantineProvider } from "@mantine/core";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { HelmetProvider } from "react-helmet-async";
import { BrowserRouter, MemoryRouter, Route, Routes } from "react-router-dom";
import { beforeAll, describe, expect, it, vi } from "vitest";
import KnowledgeGraphPage from "./knowledge-graph";
import { getKnowledgeGraph } from "../services/knowledge-service";
import { useGetSpaceBySlugQuery } from "@/features/space/queries/space-query";

vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (key: string) => key,
  }),
}));

vi.mock("@/lib/config", () => ({
  getAppName: () => "Docmost",
}));

vi.mock("@/features/space/queries/space-query", () => ({
  useGetSpacesQuery: () => ({
    data: {
      items: [
        {
          id: "space-1",
          name: "AIM",
          slug: "aim",
        },
      ],
    },
    isLoading: false,
  }),
  useGetSpaceBySlugQuery: vi.fn(() => ({
    data: undefined,
    isLoading: false,
  })),
}));

vi.mock("../services/knowledge-service", () => ({
  getKnowledgeGraph: vi.fn().mockResolvedValue({
    nodes: [
      {
        id: "kp-1",
        title: "Kafka",
        spaceId: "space-1",
        sourcePageId: "page-1",
        degree: 1,
      },
      {
        id: "kp-2",
        title: "Chaterm",
        spaceId: "space-1",
        degree: 1,
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
  }),
}));

describe("KnowledgeGraphPage", () => {
  beforeAll(() => {
    Object.defineProperty(window, "matchMedia", {
      writable: true,
      value: vi.fn().mockImplementation((query) => ({
        matches: false,
        media: query,
        onchange: null,
        addListener: vi.fn(),
        removeListener: vi.fn(),
        addEventListener: vi.fn(),
        removeEventListener: vi.fn(),
        dispatchEvent: vi.fn(),
      })),
    });
    Object.defineProperty(window, "ResizeObserver", {
      writable: true,
      value: class ResizeObserver {
        observe = vi.fn();
        unobserve = vi.fn();
        disconnect = vi.fn();
      },
    });
  });

  it("renders the selected space graph and links single-source nodes to pages", async () => {
    render(
      <QueryClientProvider client={new QueryClient()}>
        <HelmetProvider>
          <MantineProvider>
            <BrowserRouter>
              <KnowledgeGraphPage />
            </BrowserRouter>
          </MantineProvider>
        </HelmetProvider>
      </QueryClientProvider>,
    );

    expect(await screen.findByText("Kafka")).toBeTruthy();
    expect(screen.getByText("Chaterm")).toBeTruthy();
    expect(screen.getByText("depends on")).toBeTruthy();
    expect(screen.getByRole("link", { name: "Kafka" }).getAttribute("href")).toBe(
      "/p/page-1",
    );
    await waitFor(() => {
      expect(getKnowledgeGraph).toHaveBeenCalledWith({
        spaceId: "space-1",
        limit: 300,
      });
    });
  });

  it("uses the current space when rendered under a space graph route", async () => {
    vi.mocked(useGetSpaceBySlugQuery).mockReturnValue({
      data: {
        id: "space-current",
        name: "AIM",
        slug: "aim",
      },
      isLoading: false,
    } as ReturnType<typeof useGetSpaceBySlugQuery>);
    vi.mocked(getKnowledgeGraph).mockClear();

    render(
      <QueryClientProvider client={new QueryClient()}>
        <HelmetProvider>
          <MantineProvider>
            <MemoryRouter initialEntries={["/s/aim/graph"]}>
              <Routes>
                <Route path="/s/:spaceSlug/graph" element={<KnowledgeGraphPage />} />
              </Routes>
            </MemoryRouter>
          </MantineProvider>
        </HelmetProvider>
      </QueryClientProvider>,
    );

    await waitFor(() => {
      expect(getKnowledgeGraph).toHaveBeenCalledWith({
        spaceId: "space-current",
        limit: 300,
      });
    });
  });

  it("supports zoom controls for the graph canvas", async () => {
    render(
      <QueryClientProvider client={new QueryClient()}>
        <HelmetProvider>
          <MantineProvider>
            <BrowserRouter>
              <KnowledgeGraphPage />
            </BrowserRouter>
          </MantineProvider>
        </HelmetProvider>
      </QueryClientProvider>,
    );

    await screen.findByText("Kafka");
    const viewport = screen.getByTestId("knowledge-graph-viewport");
    const initialTransform = viewport.getAttribute("transform");

    fireEvent.click(screen.getByRole("button", { name: "Zoom in" }));

    expect(viewport.getAttribute("transform")).not.toBe(initialTransform);
    expect(screen.getByRole("button", { name: "Fit graph" })).toBeTruthy();
  });
});
