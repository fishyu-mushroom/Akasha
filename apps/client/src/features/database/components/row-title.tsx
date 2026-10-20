import { useState } from "react";
import { ActionIcon, Group, Text, TextInput, Tooltip } from "@mantine/core";
import { IconArrowsDiagonal, IconFileDescription } from "@tabler/icons-react";
import { useTranslation } from "react-i18next";
import { useUpdatePageMutation } from "@/features/page/queries/page-query";
import { IDatabaseRow } from "@/features/database/types/database.types";
import classes from "./database.module.css";

interface RowTitleProps {
  row: IDatabaseRow;
  editable: boolean;
  onOpen: () => void;
  onRenamed: () => void;
}

/** Title cell: click opens the row page, double-click renames inline. */
export function RowTitle({ row, editable, onOpen, onRenamed }: RowTitleProps) {
  const { t } = useTranslation();
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(row.title ?? "");
  const updatePage = useUpdatePageMutation();

  const commit = async () => {
    setEditing(false);
    if (draft === (row.title ?? "")) return;
    await updatePage.mutateAsync({ pageId: row.id, title: draft });
    onRenamed();
  };

  if (editing) {
    return (
      <div className={classes.titleCell}>
        <TextInput
          autoFocus
          size="xs"
          variant="unstyled"
          w="100%"
          value={draft}
          aria-label={t("Name")}
          onChange={(e) => setDraft(e.currentTarget.value)}
          onBlur={commit}
          onKeyDown={(e) => {
            if (e.key === "Enter") commit();
            if (e.key === "Escape") setEditing(false);
          }}
        />
      </div>
    );
  }

  return (
    <Group className={classes.titleCell} wrap="nowrap" justify="space-between">
      <Group
        gap={6}
        wrap="nowrap"
        style={{ overflow: "hidden", cursor: "pointer", flex: 1 }}
        onClick={onOpen}
        onDoubleClick={(e) => {
          if (!editable) return;
          e.preventDefault();
          setDraft(row.title ?? "");
          setEditing(true);
        }}
      >
        {row.icon ? (
          <span aria-hidden>{row.icon}</span>
        ) : (
          <IconFileDescription size={16} stroke={1.5} aria-hidden />
        )}
        <Text size="sm" fw={500} lineClamp={1}>
          {row.title || t("untitled")}
        </Text>
      </Group>
      <Tooltip label={t("Open page")} withArrow>
        <ActionIcon
          className={classes.openButton}
          variant="default"
          size="sm"
          aria-label={t("Open page")}
          onClick={onOpen}
        >
          <IconArrowsDiagonal size={12} />
        </ActionIcon>
      </Tooltip>
    </Group>
  );
}
