import { PointerEvent, WheelEvent, useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  ActionIcon,
  Alert,
  Badge,
  Button,
  Container,
  Group,
  Loader,
  Select,
  Stack,
  Text,
  Title,
  Tooltip,
} from "@mantine/core";
import { useQuery } from "@tanstack/react-query";
import { Helmet } from "react-helmet-async";
import {
  IconAlertTriangle,
  IconArrowsMaximize,
  IconArrowLeft,
  IconGitFork,
  IconRefresh,
  IconZoomIn,
  IconZoomOut,
} from "@tabler/icons-react";
import { useTranslation } from "react-i18next";
import { Link, useParams } from "react-router-dom";
import { getAppName } from "@/lib/config";
import {
  useGetSpaceBySlugQuery,
  useGetSpacesQuery,
} from "@/features/space/queries/space-query";
import { getKnowledgeGraph } from "../services/knowledge-service";
import type {
  KnowledgeGraphEdge,
  KnowledgeGraphNode,
} from "../types/knowledge.types";
import classes from "../styles/knowledge-graph.module.css";

const GRAPH_NODE_LIMIT = 300;
const GRAPH_WIDTH = 1100;
const GRAPH_HEIGHT = 680;
const MIN_ZOOM = 0.35;
const MAX_ZOOM = 3.2;
const ZOOM_STEP = 1.2;
const ENABLE_GRAPH_ANIMATION = import.meta.env.MODE !== "test";

type GraphTransform = {
  x: number;
  y: number;
  scale: number;
};

type DragState = {
  clientX: number;
  clientY: number;
  transform: GraphTransform;
};

type NodeDragState = {
  nodeId: string;
};

type GraphPoint = {
  x: number;
  y: number;
};

type SimulatedNode = GraphPoint & {
  vx: number;
  vy: number;
  degree: number;
};

export default function KnowledgeGraphPage() {
  const { t } = useTranslation();
  const { spaceSlug } = useParams();
  const [spaceId, setSpaceId] = useState<string | null>(null);
  const {
    data: routeSpace,
    isLoading: routeSpaceLoading,
  } = useGetSpaceBySlugQuery(spaceSlug ?? "");
  const { data: spacesData, isLoading: spacesLoading } = useGetSpacesQuery({
    limit: 100,
  });
  const spaces = spacesData?.items ?? [];
  const isSpaceRoute = Boolean(spaceSlug);
  const spaceOptions = useMemo(
    () =>
      routeSpace
        ? [{ value: routeSpace.id, label: routeSpace.name }]
        : spaces.map((space) => ({ value: space.id, label: space.name })),
    [routeSpace, spaces],
  );

  useEffect(() => {
    if (routeSpace?.id && spaceId !== routeSpace.id) {
      setSpaceId(routeSpace.id);
      return;
    }
    if (!spaceId && spaceOptions.length > 0) {
      setSpaceId(spaceOptions[0].value);
    }
  }, [routeSpace?.id, spaceId, spaceOptions]);

  const graphQuery = useQuery({
    queryKey: ["knowledge-graph", spaceId],
    queryFn: () =>
      getKnowledgeGraph({
        spaceId: spaceId as string,
        limit: GRAPH_NODE_LIMIT,
      }),
    enabled: Boolean(spaceId),
  });

  const graph = graphQuery.data ?? { nodes: [], edges: [] };
  const initialLayout = useMemo(
    () => buildInitialGraphLayout(graph.nodes, graph.edges),
    [graph.nodes, graph.edges],
  );
  const svgRef = useRef<SVGSVGElement | null>(null);
  const animationRef = useRef<number | null>(null);
  const simulationTickRef = useRef(0);
  const [positions, setPositions] = useState<Map<string, SimulatedNode>>(() =>
    initializeSimulation(graph.nodes, initialLayout),
  );
  const [transform, setTransform] = useState<GraphTransform>(() =>
    fitGraphTransform(graph.nodes, initialLayout),
  );
  const [dragState, setDragState] = useState<DragState | null>(null);
  const [nodeDragState, setNodeDragState] = useState<NodeDragState | null>(null);

  const fitGraph = useCallback(() => {
    setTransform(fitGraphTransform(graph.nodes, positions));
  }, [graph.nodes, positions]);

  useEffect(() => {
    const nextPositions = initializeSimulation(graph.nodes, initialLayout);
    setPositions(nextPositions);
    setTransform(fitGraphTransform(graph.nodes, initialLayout));
    simulationTickRef.current = 0;
  }, [graph.nodes, initialLayout]);

  useEffect(() => {
    if (!ENABLE_GRAPH_ANIMATION) return;

    if (animationRef.current !== null) {
      cancelAnimationFrame(animationRef.current);
    }

    const animate = () => {
      if (nodeDragState) {
        animationRef.current = requestAnimationFrame(animate);
        return;
      }

      simulationTickRef.current += 1;
      setPositions((current) =>
        simulateGraphStep({
          current,
          edges: graph.edges,
          width: GRAPH_WIDTH,
          height: GRAPH_HEIGHT,
        }),
      );

      if (simulationTickRef.current < 220) {
        animationRef.current = requestAnimationFrame(animate);
      } else {
        animationRef.current = null;
      }
    };

    if (positions.size > 1) {
      animationRef.current = requestAnimationFrame(animate);
    }

    return () => {
      if (animationRef.current !== null) {
        cancelAnimationFrame(animationRef.current);
        animationRef.current = null;
      }
    };
  }, [graph.edges, nodeDragState, positions.size]);

  const zoomAt = useCallback((factor: number, center = graphCenter()) => {
    setTransform((current) => {
      const nextScale = clamp(current.scale * factor, MIN_ZOOM, MAX_ZOOM);
      const scaleRatio = nextScale / current.scale;

      return {
        scale: nextScale,
        x: center.x - (center.x - current.x) * scaleRatio,
        y: center.y - (center.y - current.y) * scaleRatio,
      };
    });
  }, []);

  const handleWheel = useCallback(
    (event: WheelEvent<SVGSVGElement>) => {
      event.preventDefault();
      const point = clientPointToGraphPoint(svgRef.current, {
        clientX: event.clientX,
        clientY: event.clientY,
      });
      zoomAt(event.deltaY < 0 ? ZOOM_STEP : 1 / ZOOM_STEP, point);
    },
    [zoomAt],
  );

  const handlePointerDown = useCallback(
    (event: PointerEvent<SVGSVGElement>) => {
      if ((event.target as Element).closest("a")) return;

      event.currentTarget.setPointerCapture(event.pointerId);
      setDragState({
        clientX: event.clientX,
        clientY: event.clientY,
        transform,
      });
    },
    [transform],
  );

  const handlePointerMove = useCallback(
    (event: PointerEvent<SVGSVGElement>) => {
      if (nodeDragState) {
        const point = clientPointToWorldPoint(svgRef.current, transform, {
          clientX: event.clientX,
          clientY: event.clientY,
        });

        setPositions((current) => {
          const next = clonePositions(current);
          const node = next.get(nodeDragState.nodeId);
          if (node) {
            next.set(nodeDragState.nodeId, {
              ...node,
              x: point.x,
              y: point.y,
              vx: 0,
              vy: 0,
            });
          }
          return next;
        });
        return;
      }

      if (!dragState) return;

      const rect = svgRef.current?.getBoundingClientRect();
      const unitX = rect?.width ? GRAPH_WIDTH / rect.width : 1;
      const unitY = rect?.height ? GRAPH_HEIGHT / rect.height : 1;

      setTransform({
        ...dragState.transform,
        x: dragState.transform.x + (event.clientX - dragState.clientX) * unitX,
        y: dragState.transform.y + (event.clientY - dragState.clientY) * unitY,
      });
    },
    [dragState, nodeDragState, transform],
  );

  const handlePointerEnd = useCallback(() => {
    setDragState(null);
    setNodeDragState(null);
    simulationTickRef.current = 0;
  }, []);

  const handleNodePointerDown = useCallback(
    (event: PointerEvent<SVGGElement>, nodeId: string) => {
      event.preventDefault();
      event.stopPropagation();
      event.currentTarget.setPointerCapture(event.pointerId);
      setNodeDragState({ nodeId });
    },
    [],
  );

  return (
    <>
      <Helmet>
        <title>
          {t("Relationship graph")} - {getAppName()}
        </title>
      </Helmet>

      <Container fluid pt="xl" pb="xl" className={classes.pageContainer}>
        <Stack gap="lg">
          <Group justify="space-between" align="center">
            <Group gap="sm">
              <IconGitFork size={24} stroke={1.8} />
              <Title order={1} size="h3">
                {t("Relationship graph")}
              </Title>
              <Badge variant="light">{graph.nodes.length}</Badge>
            </Group>
            <Group gap="sm">
              <Button
                component={Link}
                to={spaceSlug ? `/s/${spaceSlug}` : "/knowledge"}
                variant="default"
                leftSection={<IconArrowLeft size={16} />}
              >
                {spaceSlug ? t("Space") : t("Knowledge")}
              </Button>
              <Button
                variant="default"
                leftSection={<IconRefresh size={16} />}
                loading={graphQuery.isFetching}
                disabled={!spaceId}
                onClick={() => graphQuery.refetch()}
              >
                {t("Refresh")}
              </Button>
            </Group>
          </Group>

          <Group align="end" gap="sm">
            <Select
              data={spaceOptions}
              value={spaceId}
              onChange={setSpaceId}
              label={t("Space")}
              searchable
              disabled={isSpaceRoute || spacesLoading || routeSpaceLoading}
              className={classes.spaceSelect}
            />
            {(spacesLoading || routeSpaceLoading || graphQuery.isLoading) && (
              <Loader size="sm" />
            )}
          </Group>

          {graphQuery.isError && (
            <Alert color="red" icon={<IconAlertTriangle size={18} />}>
              {graphQuery.error.message}
            </Alert>
          )}

          <section className={classes.graphPanel}>
            {graph.nodes.length === 0 && !graphQuery.isLoading ? (
              <div className={classes.emptyState}>
                <IconGitFork size={36} stroke={1.4} />
                <Text fw={600}>{t("No relationship graph yet")}</Text>
              </div>
            ) : (
              <>
                <Group gap={6} className={classes.graphControls}>
                  <Tooltip label={t("Zoom out")}>
                    <ActionIcon
                      variant="default"
                      aria-label={t("Zoom out")}
                      onClick={() => zoomAt(1 / ZOOM_STEP)}
                    >
                      <IconZoomOut size={16} />
                    </ActionIcon>
                  </Tooltip>
                  <Tooltip label={t("Zoom in")}>
                    <ActionIcon
                      variant="default"
                      aria-label={t("Zoom in")}
                      onClick={() => zoomAt(ZOOM_STEP)}
                    >
                      <IconZoomIn size={16} />
                    </ActionIcon>
                  </Tooltip>
                  <Tooltip label={t("Fit graph")}>
                    <ActionIcon
                      variant="default"
                      aria-label={t("Fit graph")}
                      onClick={fitGraph}
                    >
                      <IconArrowsMaximize size={16} />
                    </ActionIcon>
                  </Tooltip>
                </Group>
                <svg
                  ref={svgRef}
                  className={classes.graphSvg}
                  viewBox={`0 0 ${GRAPH_WIDTH} ${GRAPH_HEIGHT}`}
                  role="img"
                  aria-label={t("Relationship graph")}
                  onWheel={handleWheel}
                  onPointerDown={handlePointerDown}
                  onPointerMove={handlePointerMove}
                  onPointerUp={handlePointerEnd}
                  onPointerCancel={handlePointerEnd}
                >
                  <defs>
                    <marker
                      id="knowledge-graph-arrow"
                      markerWidth="8"
                      markerHeight="8"
                      refX="7"
                      refY="4"
                      orient="auto"
                    >
                      <path d="M0,0 L8,4 L0,8 Z" className={classes.arrowHead} />
                    </marker>
                  </defs>

                  <g
                    data-testid="knowledge-graph-viewport"
                    transform={`translate(${transform.x} ${transform.y}) scale(${transform.scale})`}
                  >
                    {graph.edges.map((edge) => {
                      const from = positions.get(edge.from);
                      const to = positions.get(edge.to);
                      if (!from || !to) return null;

                      return (
                        <g key={edge.id}>
                          <line
                            x1={from.x}
                            y1={from.y}
                            x2={to.x}
                            y2={to.y}
                            className={
                              edge.type === "semantic"
                                ? classes.semanticEdge
                                : classes.linkEdge
                            }
                            markerEnd="url(#knowledge-graph-arrow)"
                          />
                          <text
                            x={(from.x + to.x) / 2}
                            y={(from.y + to.y) / 2 - 8}
                            className={classes.edgeLabel}
                          >
                            {edge.label}
                          </text>
                        </g>
                      );
                    })}

                    {graph.nodes.map((node) => {
                      const point = positions.get(node.id);
                      if (!point) return null;
                      const radius = nodeRadius(node);

                      return (
                        <g
                          key={node.id}
                          className={classes.nodeGroup}
                          onPointerDown={(event) =>
                            handleNodePointerDown(event, node.id)
                          }
                        >
                          <circle
                            cx={point.x}
                            cy={point.y}
                            r={radius}
                            className={classes.nodeCircle}
                          />
                          {node.sourcePageId ? (
                            <a href={`/p/${node.sourcePageId}`}>
                              <text
                                x={point.x}
                                y={point.y + radius + 18}
                                className={classes.nodeLabel}
                              >
                                {node.title}
                              </text>
                            </a>
                          ) : (
                            <text
                              x={point.x}
                              y={point.y + radius + 18}
                              className={classes.nodeLabel}
                            >
                              {node.title}
                            </text>
                          )}
                        </g>
                      );
                    })}
                  </g>
                </svg>
              </>
            )}
          </section>
        </Stack>
      </Container>
    </>
  );
}

function fitGraphTransform(
  nodes: KnowledgeGraphNode[],
  layout: Map<string, GraphPoint>,
): GraphTransform {
  if (nodes.length === 0) return { x: 0, y: 0, scale: 1 };

  const points = nodes
    .map((node) => layout.get(node.id))
    .filter((point): point is GraphPoint => Boolean(point));

  if (points.length === 0) return { x: 0, y: 0, scale: 1 };

  const padding = 90;
  const minX = Math.min(...points.map((point) => point.x)) - padding;
  const maxX = Math.max(...points.map((point) => point.x)) + padding;
  const minY = Math.min(...points.map((point) => point.y)) - padding;
  const maxY = Math.max(...points.map((point) => point.y)) + padding;
  const width = Math.max(maxX - minX, 1);
  const height = Math.max(maxY - minY, 1);
  const scale = clamp(
    Math.min(GRAPH_WIDTH / width, GRAPH_HEIGHT / height),
    MIN_ZOOM,
    1.35,
  );

  return {
    scale,
    x: GRAPH_WIDTH / 2 - ((minX + maxX) / 2) * scale,
    y: GRAPH_HEIGHT / 2 - ((minY + maxY) / 2) * scale,
  };
}

function clientPointToGraphPoint(
  svg: SVGSVGElement | null,
  point: { clientX: number; clientY: number },
): { x: number; y: number } {
  const rect = svg?.getBoundingClientRect();
  if (!rect?.width || !rect.height) return graphCenter();

  return {
    x: ((point.clientX - rect.left) / rect.width) * GRAPH_WIDTH,
    y: ((point.clientY - rect.top) / rect.height) * GRAPH_HEIGHT,
  };
}

function clientPointToWorldPoint(
  svg: SVGSVGElement | null,
  transform: GraphTransform,
  point: { clientX: number; clientY: number },
): GraphPoint {
  const graphPoint = clientPointToGraphPoint(svg, point);
  return {
    x: (graphPoint.x - transform.x) / transform.scale,
    y: (graphPoint.y - transform.y) / transform.scale,
  };
}

function graphCenter(): GraphPoint {
  return { x: GRAPH_WIDTH / 2, y: GRAPH_HEIGHT / 2 };
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function buildInitialGraphLayout(
  nodes: KnowledgeGraphNode[],
  edges: KnowledgeGraphEdge[],
): Map<string, GraphPoint> {
  const connected = new Set(edges.flatMap((edge) => [edge.from, edge.to]));
  const sortedNodes = [...nodes].sort((a, b) => {
    const degreeDelta = b.degree - a.degree;
    if (degreeDelta !== 0) return degreeDelta;
    return a.title.localeCompare(b.title);
  });
  const layout = new Map<string, GraphPoint>();
  const centerX = GRAPH_WIDTH / 2;
  const centerY = GRAPH_HEIGHT / 2;
  const connectedNodes = sortedNodes.filter((node) => connected.has(node.id));
  const isolatedNodes = sortedNodes.filter((node) => !connected.has(node.id));

  connectedNodes.forEach((node, index) => {
    const angle = (index / Math.max(connectedNodes.length, 1)) * Math.PI * 2;
    const radius = 120 + (index % 3) * 92;
    layout.set(node.id, {
      x: centerX + Math.cos(angle) * radius,
      y: centerY + Math.sin(angle) * radius,
    });
  });

  isolatedNodes.forEach((node, index) => {
    const columns = 8;
    const column = index % columns;
    const row = Math.floor(index / columns);
    layout.set(node.id, {
      x: 96 + column * 130,
      y: 72 + row * 105,
    });
  });

  return layout;
}

function initializeSimulation(
  nodes: KnowledgeGraphNode[],
  layout: Map<string, GraphPoint>,
): Map<string, SimulatedNode> {
  const positions = new Map<string, SimulatedNode>();
  for (const node of nodes) {
    const point = layout.get(node.id) ?? graphCenter();
    positions.set(node.id, {
      x: point.x,
      y: point.y,
      vx: 0,
      vy: 0,
      degree: node.degree,
    });
  }
  return positions;
}

function simulateGraphStep(input: {
  current: Map<string, SimulatedNode>;
  edges: KnowledgeGraphEdge[];
  width: number;
  height: number;
}): Map<string, SimulatedNode> {
  const next = clonePositions(input.current);
  const nodes = [...next.entries()];

  for (let i = 0; i < nodes.length; i += 1) {
    const [, a] = nodes[i];
    for (let j = i + 1; j < nodes.length; j += 1) {
      const [, b] = nodes[j];
      const dx = b.x - a.x || 0.01;
      const dy = b.y - a.y || 0.01;
      const distanceSq = Math.max(dx * dx + dy * dy, 900);
      const force = 2600 / distanceSq;
      const fx = dx * force;
      const fy = dy * force;

      a.vx -= fx;
      a.vy -= fy;
      b.vx += fx;
      b.vy += fy;
    }
  }

  for (const edge of input.edges) {
    const from = next.get(edge.from);
    const to = next.get(edge.to);
    if (!from || !to) continue;

    const dx = to.x - from.x;
    const dy = to.y - from.y;
    const distance = Math.max(Math.hypot(dx, dy), 1);
    const targetDistance = edge.type === "semantic" ? 150 : 110;
    const force = (distance - targetDistance) * 0.014;
    const fx = (dx / distance) * force;
    const fy = (dy / distance) * force;

    from.vx += fx;
    from.vy += fy;
    to.vx -= fx;
    to.vy -= fy;
  }

  const center = graphCenter();
  for (const [, node] of nodes) {
    node.vx += (center.x - node.x) * 0.002;
    node.vy += (center.y - node.y) * 0.002;
    node.vx *= 0.82;
    node.vy *= 0.82;
    node.x = clamp(node.x + node.vx, 30, input.width - 30);
    node.y = clamp(node.y + node.vy, 30, input.height - 30);
  }

  return next;
}

function clonePositions(
  positions: Map<string, SimulatedNode>,
): Map<string, SimulatedNode> {
  return new Map(
    [...positions.entries()].map(([id, node]) => [id, { ...node }]),
  );
}

function nodeRadius(node: KnowledgeGraphNode): number {
  return Math.min(22, 9 + node.degree * 2);
}
