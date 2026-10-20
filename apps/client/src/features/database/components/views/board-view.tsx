import { useEffect, useMemo, useRef, useState } from "react";
import { Badge, Card, Group, ScrollArea, Stack, Text } from "@mantine/core";
import { IconPlus } from "@tabler/icons-react";
import { useTranslation } from "react-i18next";
import {
  draggable,
  dropTargetForElements,
} from "@atlaskit/pragmatic-drag-and-drop/element/adapter";
import { combine } from "@atlaskit/pragmatic-drag-and-drop/combine";
import {
  IDatabaseInfo,
  IDatabaseProperty,
  IDatabaseRow,
  IDatabaseView,
  SelectOption,
} from "@/features/database/types/database.types";
import { DatabaseActions } from "@/features/database/hooks/use-database-actions";
import {
  getOptions,
  isEmptyValue,
  visibleProperties,
} from "@/features/database/utils/database.utils";
import { OptionBadge, PropertyValue, useMemberMap } from "../property-value";
import classes from "./board-view.module.css";

const NO_VALUE = "__none";

interface BoardViewProps {
  info: IDatabaseInfo;
  view: IDatabaseView;
  rows: IDatabaseRow[];
  editable: boolean;
  actions: DatabaseActions;
}

type DropPlacement = { rowId: string; edge: "top" | "bottom" } | null;

export function BoardView({
  info,
  view,
  rows,
  editable,
  actions,
}: BoardViewProps) {
  const { t } = useTranslation();
  const groupProperty = info.properties.find(
    (p) => p.id === view.config.groupBy,
  );

  // Optimistic placement while a move request is in flight.
  const [optimistic, setOptimistic] = useState<IDatabaseRow[] | null>(null);
  useEffect(() => setOptimistic(null), [rows]);
  const current = optimistic ?? rows;

  const columns = useMemo(() => {
    if (!groupProperty) return [];
    const options = getOptions(groupProperty);
    const known = new Set(options.map((o) => o.id));
    const byGroup = new Map<string, IDatabaseRow[]>(
      [NO_VALUE, ...options.map((o) => o.id)].map((id) => [id, []]),
    );
    for (const row of current) {
      const value = row.properties[groupProperty.id] as string | undefined;
      byGroup.get(value && known.has(value) ? value : NO_VALUE)!.push(row);
    }
    return [
      { id: NO_VALUE, option: undefined as SelectOption | undefined },
      ...options.map((option) => ({ id: option.id, option })),
    ].map((column) => ({ ...column, rows: byGroup.get(column.id)! }));
  }, [groupProperty, current]);

  if (!groupProperty) {
    return (
      <Text c="dimmed" size="sm">
        {t("Choose a select or status property to group this board by.")}
      </Text>
    );
  }

  const cardProperties = visibleProperties(view, info.properties).filter(
    (p) => p.id !== groupProperty.id,
  );

  const moveCard = (
    rowId: string,
    columnId: string,
    placement: DropPlacement,
  ) => {
    const row = current.find((r) => r.id === rowId);
    if (!row) return;
    const column = columns.find((c) => c.id === columnId)!;
    const target = column.rows.filter((r) => r.id !== rowId);
    let index = target.length;
    if (placement) {
      const at = target.findIndex((r) => r.id === placement.rowId);
      if (at >= 0) index = placement.edge === "top" ? at : at + 1;
    }
    const groupValue = columnId === NO_VALUE ? null : columnId;
    const previous = row.properties[groupProperty.id] ?? null;
    const sameGroup = previous === groupValue;
    const neighbours = {
      afterPageId: target[index - 1]?.id,
      beforePageId: target[index]?.id,
    };
    if (
      sameGroup &&
      column.rows[column.rows.indexOf(row) - 1]?.id === neighbours.afterPageId &&
      column.rows[column.rows.indexOf(row) + 1]?.id === neighbours.beforePageId
    ) {
      return;
    }

    const moved: IDatabaseRow = {
      ...row,
      properties: { ...row.properties, [groupProperty.id]: groupValue },
    };
    const others = current.filter((r) => r.id !== rowId);
    const anchor = neighbours.beforePageId
      ? others.findIndex((r) => r.id === neighbours.beforePageId)
      : neighbours.afterPageId
        ? others.findIndex((r) => r.id === neighbours.afterPageId) + 1
        : others.length;
    setOptimistic([...others.slice(0, anchor), moved, ...others.slice(anchor)]);

    actions.mutations.moveRow.mutate(
      {
        pageId: rowId,
        ...neighbours,
        ...(sameGroup ? {} : { properties: { [groupProperty.id]: groupValue } }),
      },
      { onError: () => setOptimistic(null) },
    );
  };

  return (
    <ScrollArea type="auto" offsetScrollbars>
      <Group align="flex-start" wrap="nowrap" gap="sm" pb="sm">
        {columns.map((column) => (
          <BoardColumn
            key={column.id}
            columnId={column.id}
            option={column.option}
            rows={column.rows}
            groupProperty={groupProperty}
            cardProperties={cardProperties}
            editable={editable}
            actions={actions}
            onMove={moveCard}
          />
        ))}
      </Group>
    </ScrollArea>
  );
}

interface BoardColumnProps {
  columnId: string;
  option?: SelectOption;
  rows: IDatabaseRow[];
  groupProperty: IDatabaseProperty;
  cardProperties: IDatabaseProperty[];
  editable: boolean;
  actions: DatabaseActions;
  onMove: (rowId: string, columnId: string, placement: DropPlacement) => void;
}

function BoardColumn({
  columnId,
  option,
  rows,
  groupProperty,
  cardProperties,
  editable,
  actions,
  onMove,
}: BoardColumnProps) {
  const { t } = useTranslation();
  const ref = useRef<HTMLDivElement>(null);
  const [isOver, setIsOver] = useState(false);
  const [placement, setPlacement] = useState<DropPlacement>(null);
  const members = useMemberMap();

  useEffect(() => {
    const element = ref.current;
    if (!element || !editable) return;
    return dropTargetForElements({
      element,
      canDrop: ({ source }) => source.data.type === "database-card",
      getData: () => ({ columnId }),
      onDragEnter: () => setIsOver(true),
      onDragLeave: () => {
        setIsOver(false);
        setPlacement(null);
      },
      onDrop: ({ source, location }) => {
        setIsOver(false);
        setPlacement(null);
        // A card drop target inside this column handles placement itself.
        const inner = location.current.dropTargets.find(
          (target) => target.data.cardId,
        );
        onMove(
          source.data.rowId as string,
          columnId,
          inner
            ? {
                rowId: inner.data.cardId as string,
                edge: inner.data.edge as "top" | "bottom",
              }
            : null,
        );
      },
    });
  }, [columnId, editable, onMove]);

  const addCard = async () => {
    const row = await actions.createRow(
      columnId === NO_VALUE ? {} : { [groupProperty.id]: columnId },
    );
    actions.openRow(row);
  };

  return (
    <div
      ref={ref}
      className={classes.column}
      data-over={isOver || undefined}
      aria-label={option?.name ?? t("No {{name}}", { name: groupProperty.name })}
      role="list"
    >
      <Group gap={6} mb="xs" px={4}>
        {option ? (
          <OptionBadge option={option} />
        ) : (
          <Text size="sm" c="dimmed">
            {t("No {{name}}", { name: groupProperty.name })}
          </Text>
        )}
        <Badge size="xs" variant="transparent" color="gray">
          {rows.length}
        </Badge>
      </Group>
      <Stack gap={6}>
        {rows.map((row) => (
          <BoardCard
            key={row.id}
            row={row}
            properties={cardProperties}
            members={members}
            editable={editable}
            indicator={placement?.rowId === row.id ? placement.edge : null}
            onIndicator={setPlacement}
            onOpen={() => actions.openRow(row)}
          />
        ))}
      </Stack>
      {editable && (
        <button type="button" className={classes.addCard} onClick={addCard}>
          <Group gap={6}>
            <IconPlus size={14} />
            {t("New")}
          </Group>
        </button>
      )}
    </div>
  );
}

interface BoardCardProps {
  row: IDatabaseRow;
  properties: IDatabaseProperty[];
  members: ReturnType<typeof useMemberMap>;
  editable: boolean;
  indicator: "top" | "bottom" | null;
  onIndicator: (placement: DropPlacement) => void;
  onOpen: () => void;
}

function BoardCard({
  row,
  properties,
  members,
  editable,
  indicator,
  onIndicator,
  onOpen,
}: BoardCardProps) {
  const { t } = useTranslation();
  const ref = useRef<HTMLDivElement>(null);
  const [dragging, setDragging] = useState(false);

  useEffect(() => {
    const element = ref.current;
    if (!element || !editable) return;
    const edgeOf = (clientY: number): "top" | "bottom" => {
      const rect = element.getBoundingClientRect();
      return clientY < rect.top + rect.height / 2 ? "top" : "bottom";
    };
    return combine(
      draggable({
        element,
        getInitialData: () => ({ type: "database-card", rowId: row.id }),
        onDragStart: () => setDragging(true),
        onDrop: () => setDragging(false),
      }),
      dropTargetForElements({
        element,
        canDrop: ({ source }) =>
          source.data.type === "database-card" && source.data.rowId !== row.id,
        getData: ({ input }) => ({
          cardId: row.id,
          edge: edgeOf(input.clientY),
        }),
        onDrag: ({ self }) =>
          onIndicator({ rowId: row.id, edge: self.data.edge as "top" | "bottom" }),
        onDragLeave: () => onIndicator(null),
      }),
    );
  }, [row.id, editable, onIndicator]);

  const filled = properties.filter((p) => !isEmptyValue(row.properties[p.id]));

  return (
    <Card
      ref={ref}
      withBorder
      padding="xs"
      radius="sm"
      role="listitem"
      tabIndex={0}
      className={classes.card}
      data-dragging={dragging || undefined}
      data-indicator={indicator ?? undefined}
      onClick={onOpen}
      onKeyDown={(e) => e.key === "Enter" && onOpen()}
    >
      <Text size="sm" fw={500} lineClamp={2}>
        {row.icon ? `${row.icon} ` : ""}
        {row.title || t("untitled")}
      </Text>
      {filled.length > 0 && (
        <Stack gap={4} mt={6}>
          {filled.map((property) => (
            <PropertyValue
              key={property.id}
              property={property}
              value={row.properties[property.id]}
              members={members}
            />
          ))}
        </Stack>
      )}
    </Card>
  );
}
