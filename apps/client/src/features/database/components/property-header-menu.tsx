import { useState } from "react";
import {
  ActionIcon,
  Button,
  Menu,
  Popover,
  Stack,
  TextInput,
  Tooltip,
} from "@mantine/core";
import {
  IconArrowDown,
  IconArrowUp,
  IconEyeOff,
  IconPlus,
  IconTrash,
} from "@tabler/icons-react";
import { useTranslation } from "react-i18next";
import { modals } from "@mantine/modals";
import {
  IDatabaseProperty,
  PROPERTY_TYPES,
  PropertyType,
} from "@/features/database/types/database.types";
import { PROPERTY_TYPE_LABELS } from "@/features/database/utils/database.utils";
import { PropertyTypeIcon } from "./property-type-icon";

interface PropertyHeaderMenuProps {
  property: IDatabaseProperty;
  editable: boolean;
  children: React.ReactNode;
  onRename: (name: string) => void;
  onSort: (direction: "asc" | "desc") => void;
  onHide: () => void;
  onDelete: () => void;
}

export function PropertyHeaderMenu({
  property,
  editable,
  children,
  onRename,
  onSort,
  onHide,
  onDelete,
}: PropertyHeaderMenuProps) {
  const { t } = useTranslation();
  const [name, setName] = useState(property.name);

  const confirmDelete = () =>
    modals.openConfirmModal({
      title: t("Delete property"),
      children: t(
        "This removes the property and its values from every row. This cannot be undone.",
      ),
      labels: { confirm: t("Delete"), cancel: t("Cancel") },
      confirmProps: { color: "red" },
      onConfirm: onDelete,
    });

  return (
    <Menu
      shadow="md"
      width={220}
      position="bottom-start"
      onClose={() => name.trim() && name !== property.name && onRename(name)}
    >
      <Menu.Target>{children}</Menu.Target>
      <Menu.Dropdown>
        {editable && (
          <>
            <TextInput
              size="xs"
              m={4}
              value={name}
              aria-label={t("Property name")}
              onChange={(e) => setName(e.currentTarget.value)}
              onKeyDown={(e) => e.stopPropagation()}
            />
            <Menu.Label>{t(PROPERTY_TYPE_LABELS[property.type])}</Menu.Label>
          </>
        )}
        <Menu.Item
          leftSection={<IconArrowUp size={14} />}
          onClick={() => onSort("asc")}
        >
          {t("Sort ascending")}
        </Menu.Item>
        <Menu.Item
          leftSection={<IconArrowDown size={14} />}
          onClick={() => onSort("desc")}
        >
          {t("Sort descending")}
        </Menu.Item>
        <Menu.Item leftSection={<IconEyeOff size={14} />} onClick={onHide}>
          {t("Hide in view")}
        </Menu.Item>
        {editable && (
          <>
            <Menu.Divider />
            <Menu.Item
              color="red"
              leftSection={<IconTrash size={14} />}
              onClick={confirmDelete}
            >
              {t("Delete property")}
            </Menu.Item>
          </>
        )}
      </Menu.Dropdown>
    </Menu>
  );
}

interface AddPropertyButtonProps {
  onCreate: (name: string, type: PropertyType) => void;
}

export function AddPropertyButton({ onCreate }: AddPropertyButtonProps) {
  const { t } = useTranslation();
  const [opened, setOpened] = useState(false);
  const [name, setName] = useState("");

  const create = (type: PropertyType) => {
    onCreate(name.trim() || t(PROPERTY_TYPE_LABELS[type]), type);
    setName("");
    setOpened(false);
  };

  return (
    <Popover
      opened={opened}
      onChange={setOpened}
      position="bottom-end"
      shadow="md"
      trapFocus
    >
      <Popover.Target>
        <Tooltip label={t("Add property")} withArrow>
          <ActionIcon
            variant="subtle"
            color="gray"
            aria-label={t("Add property")}
            onClick={() => setOpened((o) => !o)}
          >
            <IconPlus size={16} />
          </ActionIcon>
        </Tooltip>
      </Popover.Target>
      <Popover.Dropdown p="xs">
        <Stack gap={4} w={200}>
          <TextInput
            size="xs"
            placeholder={t("Property name")}
            value={name}
            onChange={(e) => setName(e.currentTarget.value)}
          />
          {PROPERTY_TYPES.map((type) => (
            <Button
              key={type}
              size="compact-sm"
              variant="subtle"
              color="gray"
              justify="flex-start"
              leftSection={<PropertyTypeIcon type={type} />}
              onClick={() => create(type)}
            >
              {t(PROPERTY_TYPE_LABELS[type])}
            </Button>
          ))}
        </Stack>
      </Popover.Dropdown>
    </Popover>
  );
}
