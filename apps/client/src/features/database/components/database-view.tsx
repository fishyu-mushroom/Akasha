import { useState } from "react";
import { useSearchParams } from "react-router-dom";
import {
  ActionIcon,
  Group,
  Loader,
  Menu,
  Pagination,
  Stack,
  Tabs,
  Text,
  TextInput,
} from "@mantine/core";
import {
  IconCalendar,
  IconLayoutKanban,
  IconPencil,
  IconPlus,
  IconTable,
  IconTrash,
} from "@tabler/icons-react";
import { useTranslation } from "react-i18next";
import { modals } from "@mantine/modals";
import {
  useDatabaseInfoQuery,
  useDatabaseRowsQuery,
} from "@/features/database/queries/database-query";
import { useDatabaseActions } from "@/features/database/hooks/use-database-actions";
import {
  IDatabaseInfo,
  IDatabaseView,
  ViewType,
} from "@/features/database/types/database.types";
import { TableView } from "./views/table-view";
import { BoardView } from "./views/board-view";
import { CalendarView } from "./views/calendar-view";
import { ViewToolbar } from "./view-toolbar";

const PAGE_SIZE = 200;

const VIEW_ICONS: Record<ViewType, typeof IconTable> = {
  table: IconTable,
  board: IconLayoutKanban,
  calendar: IconCalendar,
};

export function DatabaseView({ databaseId }: { databaseId: string }) {
  const { t } = useTranslation();
  const { data: info, isLoading } = useDatabaseInfoQuery(databaseId);
  const [searchParams, setSearchParams] = useSearchParams();

  if (isLoading || !info) {
    return isLoading ? <Loader size="sm" m="md" /> : null;
  }

  const activeView =
    info.views.find((v) => v.id === searchParams.get("view")) ?? info.views[0];
  const selectView = (viewId: string) =>
    setSearchParams(
      (params) => {
        params.set("view", viewId);
        return params;
      },
      { replace: true },
    );

  if (!activeView) {
    return <Text c="dimmed">{t("This database has no views.")}</Text>;
  }

  return (
    <DatabaseViewContent
      info={info}
      view={activeView}
      onSelectView={selectView}
    />
  );
}

function DatabaseViewContent({
  info,
  view,
  onSelectView,
}: {
  info: IDatabaseInfo;
  view: IDatabaseView;
  onSelectView: (viewId: string) => void;
}) {
  const editable =
    !info.database.deletedAt && (info.permissions?.canEdit ?? false);
  const actions = useDatabaseActions(info.database.id, info.database.spaceId);

  return (
    <Stack gap="xs">
      <Group justify="space-between" wrap="nowrap" align="flex-end">
        <ViewTabs
          info={info}
          activeView={view}
          editable={editable}
          actions={actions}
          onSelect={onSelectView}
        />
        <ViewToolbar
          view={view}
          properties={info.properties}
          editable={editable}
          actions={actions}
        />
      </Group>
      {view.type === "calendar" ? (
        <CalendarView
          info={info}
          view={view}
          editable={editable}
          actions={actions}
        />
      ) : (
        <PagedRows info={info} view={view} editable={editable} actions={actions} />
      )}
    </Stack>
  );
}

function PagedRows({
  info,
  view,
  editable,
  actions,
}: {
  info: IDatabaseInfo;
  view: IDatabaseView;
  editable: boolean;
  actions: ReturnType<typeof useDatabaseActions>;
}) {
  const { t } = useTranslation();
  const [page, setPage] = useState(1);
  const { data, isLoading } = useDatabaseRowsQuery({
    databaseId: info.database.id,
    viewId: view.id,
    offset: (page - 1) * PAGE_SIZE,
    limit: PAGE_SIZE,
  });
  const rows = data?.items ?? [];
  const total = data?.total ?? 0;

  if (isLoading) return <Loader size="sm" />;

  return (
    <Stack gap="xs">
      {view.type === "board" ? (
        <BoardView
          info={info}
          view={view}
          rows={rows}
          editable={editable}
          actions={actions}
        />
      ) : (
        <TableView
          info={info}
          view={view}
          rows={rows}
          editable={editable}
          actions={actions}
        />
      )}
      <Group justify="space-between">
        <Text size="xs" c="dimmed">
          {t("{{count}} rows", { count: total })}
        </Text>
        {total > PAGE_SIZE && (
          <Pagination
            size="sm"
            total={Math.ceil(total / PAGE_SIZE)}
            value={page}
            onChange={setPage}
          />
        )}
      </Group>
    </Stack>
  );
}

function ViewTabs({
  info,
  activeView,
  editable,
  actions,
  onSelect,
}: {
  info: IDatabaseInfo;
  activeView: IDatabaseView;
  editable: boolean;
  actions: ReturnType<typeof useDatabaseActions>;
  onSelect: (viewId: string) => void;
}) {
  const { t } = useTranslation();
  const [renaming, setRenaming] = useState<string | null>(null);
  const [draft, setDraft] = useState("");

  const addView = async (type: ViewType) => {
    const names: Record<ViewType, string> = {
      table: t("Table"),
      board: t("Board"),
      calendar: t("Calendar"),
    };
    const view = await actions.mutations.createView.mutateAsync({
      databaseId: info.database.id,
      name: names[type],
      type,
    });
    onSelect(view.id);
  };

  const hasGroupable = info.properties.some(
    (p) => p.type === "status" || p.type === "select",
  );
  const hasDate = info.properties.some((p) => p.type === "date");

  const commitRename = (view: IDatabaseView) => {
    setRenaming(null);
    if (draft.trim() && draft !== view.name) {
      actions.mutations.updateView.mutate({ viewId: view.id, name: draft });
    }
  };

  return (
    <Group gap={4} wrap="nowrap" style={{ overflowX: "auto" }}>
      <Tabs
        value={activeView.id}
        onChange={(value) => value && onSelect(value)}
        variant="pills"
        radius="sm"
      >
        <Tabs.List>
          {info.views.map((view) => {
            const Icon = VIEW_ICONS[view.type];
            if (renaming === view.id) {
              return (
                <TextInput
                  key={view.id}
                  autoFocus
                  size="xs"
                  w={140}
                  value={draft}
                  aria-label={t("View name")}
                  onChange={(e) => setDraft(e.currentTarget.value)}
                  onBlur={() => commitRename(view)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") commitRename(view);
                    if (e.key === "Escape") setRenaming(null);
                  }}
                />
              );
            }
            return (
              <Menu
                key={view.id}
                trigger="click-hover"
                openDelay={600}
                position="bottom-start"
                disabled={!editable || view.id !== activeView.id}
              >
                <Menu.Target>
                  <Tabs.Tab
                    value={view.id}
                    leftSection={<Icon size={14} />}
                  >
                    {view.name}
                  </Tabs.Tab>
                </Menu.Target>
                <Menu.Dropdown>
                  <Menu.Item
                    leftSection={<IconPencil size={14} />}
                    onClick={() => {
                      setDraft(view.name);
                      setRenaming(view.id);
                    }}
                  >
                    {t("Rename")}
                  </Menu.Item>
                  <Menu.Item
                    color="red"
                    disabled={info.views.length <= 1}
                    leftSection={<IconTrash size={14} />}
                    onClick={() =>
                      modals.openConfirmModal({
                        title: t("Delete view"),
                        children: t("Rows and properties are kept."),
                        labels: { confirm: t("Delete"), cancel: t("Cancel") },
                        confirmProps: { color: "red" },
                        onConfirm: () =>
                          actions.mutations.deleteView.mutate(view.id),
                      })
                    }
                  >
                    {t("Delete view")}
                  </Menu.Item>
                </Menu.Dropdown>
              </Menu>
            );
          })}
        </Tabs.List>
      </Tabs>
      {editable && (
        <Menu position="bottom-start" shadow="md">
          <Menu.Target>
            <ActionIcon
              variant="subtle"
              color="gray"
              aria-label={t("Add view")}
            >
              <IconPlus size={16} />
            </ActionIcon>
          </Menu.Target>
          <Menu.Dropdown>
            <Menu.Item
              leftSection={<IconTable size={14} />}
              onClick={() => addView("table")}
            >
              {t("Table")}
            </Menu.Item>
            <Menu.Item
              leftSection={<IconLayoutKanban size={14} />}
              disabled={!hasGroupable}
              onClick={() => addView("board")}
            >
              {t("Board")}
            </Menu.Item>
            <Menu.Item
              leftSection={<IconCalendar size={14} />}
              disabled={!hasDate}
              onClick={() => addView("calendar")}
            >
              {t("Calendar")}
            </Menu.Item>
            {(!hasGroupable || !hasDate) && (
              <Menu.Label>
                {t("Board needs a select or status property; calendar needs a date property.")}
              </Menu.Label>
            )}
          </Menu.Dropdown>
        </Menu>
      )}
    </Group>
  );
}
