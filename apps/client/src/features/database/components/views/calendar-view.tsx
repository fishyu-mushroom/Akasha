import { useEffect, useMemo, useRef, useState } from "react";
import { ActionIcon, Group, Loader, Text, Tooltip } from "@mantine/core";
import {
  IconChevronLeft,
  IconChevronRight,
  IconPlus,
} from "@tabler/icons-react";
import { useTranslation } from "react-i18next";
import {
  addDays,
  addMonths,
  differenceInCalendarDays,
  eachDayOfInterval,
  endOfMonth,
  endOfWeek,
  format,
  isSameMonth,
  isToday,
  parseISO,
  startOfMonth,
  startOfWeek,
} from "date-fns";
import {
  draggable,
  dropTargetForElements,
} from "@atlaskit/pragmatic-drag-and-drop/element/adapter";
import {
  DateValue,
  IDatabaseInfo,
  IDatabaseRow,
  IDatabaseView,
} from "@/features/database/types/database.types";
import { DatabaseActions } from "@/features/database/hooks/use-database-actions";
import { useDatabaseRowsQuery } from "@/features/database/queries/database-query";
import classes from "./calendar-view.module.css";

const DAY = "yyyy-MM-dd";

interface CalendarViewProps {
  info: IDatabaseInfo;
  view: IDatabaseView;
  editable: boolean;
  actions: DatabaseActions;
}

export function CalendarView({
  info,
  view,
  editable,
  actions,
}: CalendarViewProps) {
  const { t } = useTranslation();
  const [month, setMonth] = useState(() => startOfMonth(new Date()));
  const dateProperty = info.properties.find(
    (p) => p.id === view.config.dateProperty,
  );

  const days = useMemo(
    () =>
      eachDayOfInterval({
        start: startOfWeek(startOfMonth(month), { weekStartsOn: 1 }),
        end: endOfWeek(endOfMonth(month), { weekStartsOn: 1 }),
      }),
    [month],
  );
  const rangeStart = format(days[0], DAY);
  const rangeEnd = format(days[days.length - 1], DAY);

  const { data, isLoading } = useDatabaseRowsQuery(
    {
      databaseId: info.database.id,
      viewId: view.id,
      dateProperty: dateProperty?.id,
      rangeStart,
      rangeEnd,
      limit: 200,
    },
    Boolean(dateProperty),
  );

  const byDay = useMemo(() => {
    const map = new Map<string, IDatabaseRow[]>();
    if (!dateProperty) return map;
    for (const row of data?.items ?? []) {
      const value = row.properties[dateProperty.id] as DateValue | undefined;
      if (!value?.start) continue;
      const start = value.start.slice(0, 10);
      const end = (value.end ?? value.start).slice(0, 10);
      for (
        let day = parseISO(start < rangeStart ? rangeStart : start);
        format(day, DAY) <= end && format(day, DAY) <= rangeEnd;
        day = addDays(day, 1)
      ) {
        const key = format(day, DAY);
        map.set(key, [...(map.get(key) ?? []), row]);
      }
    }
    return map;
  }, [data, dateProperty, rangeStart, rangeEnd]);

  if (!dateProperty) {
    return (
      <Text c="dimmed" size="sm">
        {t("Choose a date property for this calendar.")}
      </Text>
    );
  }

  const moveToDay = (rowId: string, day: string) => {
    const row = data?.items.find((r) => r.id === rowId);
    const value = row?.properties[dateProperty.id] as DateValue | undefined;
    if (!row || !value?.start || value.start.slice(0, 10) === day) return;
    const length = value.end
      ? differenceInCalendarDays(parseISO(value.end), parseISO(value.start))
      : 0;
    actions.updateCell(row, dateProperty.id, {
      start: day,
      ...(length > 0 ? { end: format(addDays(parseISO(day), length), DAY) } : {}),
    });
  };

  const createOn = async (day: string) => {
    const row = await actions.createRow({ [dateProperty.id]: { start: day } });
    actions.openRow(row);
  };

  const weekdays = days.slice(0, 7).map((d) => format(d, "EEE"));

  return (
    <div>
      <Group justify="space-between" mb="xs">
        <Text fw={600}>{format(month, "yyyy-MM")}</Text>
        <Group gap={4}>
          {isLoading && <Loader size="xs" />}
          <ActionIcon
            variant="subtle"
            color="gray"
            aria-label={t("Previous month")}
            onClick={() => setMonth((m) => addMonths(m, -1))}
          >
            <IconChevronLeft size={16} />
          </ActionIcon>
          <ActionIcon
            variant="subtle"
            color="gray"
            aria-label={t("Today")}
            onClick={() => setMonth(startOfMonth(new Date()))}
          >
            <Text size="xs">{t("Today")}</Text>
          </ActionIcon>
          <ActionIcon
            variant="subtle"
            color="gray"
            aria-label={t("Next month")}
            onClick={() => setMonth((m) => addMonths(m, 1))}
          >
            <IconChevronRight size={16} />
          </ActionIcon>
        </Group>
      </Group>
      <div className={classes.grid} role="grid">
        {weekdays.map((name) => (
          <div key={name} className={classes.weekday} role="columnheader">
            {name}
          </div>
        ))}
        {days.map((day) => {
          const key = format(day, DAY);
          return (
            <CalendarDay
              key={key}
              day={key}
              label={format(day, "d")}
              outside={!isSameMonth(day, month)}
              today={isToday(day)}
              rows={byDay.get(key) ?? []}
              editable={editable}
              onDropRow={moveToDay}
              onCreate={() => createOn(key)}
              onOpen={actions.openRow}
            />
          );
        })}
      </div>
    </div>
  );
}

interface CalendarDayProps {
  day: string;
  label: string;
  outside: boolean;
  today: boolean;
  rows: IDatabaseRow[];
  editable: boolean;
  onDropRow: (rowId: string, day: string) => void;
  onCreate: () => void;
  onOpen: (row: IDatabaseRow) => void;
}

function CalendarDay({
  day,
  label,
  outside,
  today,
  rows,
  editable,
  onDropRow,
  onCreate,
  onOpen,
}: CalendarDayProps) {
  const { t } = useTranslation();
  const ref = useRef<HTMLDivElement>(null);
  const [over, setOver] = useState(false);

  useEffect(() => {
    const element = ref.current;
    if (!element || !editable) return;
    return dropTargetForElements({
      element,
      canDrop: ({ source }) => source.data.type === "database-calendar-item",
      onDragEnter: () => setOver(true),
      onDragLeave: () => setOver(false),
      onDrop: ({ source }) => {
        setOver(false);
        onDropRow(source.data.rowId as string, day);
      },
    });
  }, [day, editable, onDropRow]);

  return (
    <div
      ref={ref}
      role="gridcell"
      aria-label={day}
      className={classes.day}
      data-outside={outside || undefined}
      data-over={over || undefined}
    >
      <Group justify="space-between" gap={0}>
        <span className={classes.dayNumber} data-today={today || undefined}>
          {label}
        </span>
        {editable && (
          <Tooltip label={t("New")} withArrow openDelay={300}>
            <ActionIcon
              className={classes.addButton}
              size="xs"
              variant="subtle"
              color="gray"
              aria-label={t("New")}
              onClick={onCreate}
            >
              <IconPlus size={12} />
            </ActionIcon>
          </Tooltip>
        )}
      </Group>
      {rows.map((row) => (
        <CalendarItem
          key={row.id}
          row={row}
          editable={editable}
          onOpen={() => onOpen(row)}
        />
      ))}
    </div>
  );
}

function CalendarItem({
  row,
  editable,
  onOpen,
}: {
  row: IDatabaseRow;
  editable: boolean;
  onOpen: () => void;
}) {
  const { t } = useTranslation();
  const ref = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    const element = ref.current;
    if (!element || !editable) return;
    return draggable({
      element,
      getInitialData: () => ({ type: "database-calendar-item", rowId: row.id }),
    });
  }, [row.id, editable]);

  return (
    <button ref={ref} type="button" className={classes.item} onClick={onOpen}>
      {row.icon ? `${row.icon} ` : ""}
      {row.title || t("untitled")}
    </button>
  );
}
