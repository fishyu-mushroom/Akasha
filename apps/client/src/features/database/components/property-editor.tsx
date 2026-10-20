import { useState } from "react";
import {
  Button,
  Combobox,
  Group,
  MultiSelect,
  NumberInput,
  Stack,
  Switch,
  TextInput,
  useCombobox,
} from "@mantine/core";
import { DatePicker } from "@mantine/dates";
import { useDebouncedValue } from "@mantine/hooks";
import { IconCheck, IconPlus } from "@tabler/icons-react";
import { useTranslation } from "react-i18next";
import { useWorkspaceMembersQuery } from "@/features/workspace/queries/workspace-query";
import {
  DateValue,
  IDatabaseProperty,
  PropertyConfig,
  PropertyValue,
  SelectOption,
} from "@/features/database/types/database.types";
import {
  getOptions,
  newOptionId,
  OPTION_COLORS,
} from "@/features/database/utils/database.utils";
import { OptionBadge, useMemberMap } from "./property-value";

interface PropertyEditorProps {
  property: IDatabaseProperty;
  value: PropertyValue | undefined;
  onChange: (value: PropertyValue) => void;
  onClose: () => void;
  /** Persists new select options before the value referencing them. */
  onUpdateConfig?: (config: PropertyConfig) => Promise<unknown>;
}

/** Popover body for editing one property value. */
export function PropertyEditor(props: PropertyEditorProps) {
  switch (props.property.type) {
    case "text":
    case "url":
      return <TextEditor {...props} />;
    case "number":
      return <NumberEditor {...props} />;
    case "select":
    case "status":
    case "multi_select":
      return <OptionEditor {...props} />;
    case "date":
      return <DateEditor {...props} />;
    case "person":
      return <PersonEditor {...props} />;
    default:
      return null;
  }
}

function TextEditor({ property, value, onChange, onClose }: PropertyEditorProps) {
  const [draft, setDraft] = useState(String(value ?? ""));
  const commit = () => {
    onChange(draft.trim() === "" ? null : draft);
    onClose();
  };
  return (
    <TextInput
      autoFocus
      size="xs"
      w={260}
      value={draft}
      placeholder={property.type === "url" ? "https://" : undefined}
      onChange={(e) => setDraft(e.currentTarget.value)}
      onBlur={commit}
      onKeyDown={(e) => {
        if (e.key === "Enter") commit();
        if (e.key === "Escape") onClose();
      }}
    />
  );
}

function NumberEditor({ value, onChange, onClose }: PropertyEditorProps) {
  const [draft, setDraft] = useState<string | number>(
    typeof value === "number" ? value : "",
  );
  const commit = () => {
    onChange(typeof draft === "number" ? draft : null);
    onClose();
  };
  return (
    <NumberInput
      autoFocus
      size="xs"
      w={200}
      value={draft}
      onChange={setDraft}
      onBlur={commit}
      onKeyDown={(e) => {
        if (e.key === "Enter") commit();
        if (e.key === "Escape") onClose();
      }}
    />
  );
}

function OptionEditor({
  property,
  value,
  onChange,
  onClose,
  onUpdateConfig,
}: PropertyEditorProps) {
  const { t } = useTranslation();
  const multi = property.type === "multi_select";
  const options = getOptions(property);
  const selected = new Set(
    multi ? ((value as string[]) ?? []) : value ? [value as string] : [],
  );
  const [search, setSearch] = useState("");
  const combobox = useCombobox({ opened: true });

  const toggle = (id: string) => {
    if (multi) {
      const next = new Set(selected);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      onChange([...next]);
    } else {
      onChange(selected.has(id) ? null : id);
      onClose();
    }
  };

  const createOption = async () => {
    const name = search.trim();
    if (!name || !onUpdateConfig) return;
    const option: SelectOption = {
      id: newOptionId(),
      name,
      color: OPTION_COLORS[options.length % OPTION_COLORS.length],
      ...(property.type === "status" ? { group: "todo" as const } : {}),
    };
    await onUpdateConfig({ ...property.config, options: [...options, option] });
    setSearch("");
    toggle(option.id);
  };

  const query = search.trim().toLowerCase();
  const filtered = options.filter((o) => o.name.toLowerCase().includes(query));
  const exactMatch = options.some((o) => o.name.toLowerCase() === query);

  return (
    <Combobox store={combobox} onOptionSubmit={(id) => (id === "__create" ? createOption() : toggle(id))}>
      <Combobox.EventsTarget>
        <TextInput
          autoFocus
          size="xs"
          w={240}
          value={search}
          placeholder={t("Search or create an option")}
          onChange={(e) => setSearch(e.currentTarget.value)}
          onKeyDown={(e) => e.key === "Escape" && onClose()}
        />
      </Combobox.EventsTarget>
      <Combobox.Options mt={6} mah={240} style={{ overflowY: "auto" }}>
        {filtered.map((option) => (
          <Combobox.Option value={option.id} key={option.id}>
            <Group justify="space-between" wrap="nowrap">
              <OptionBadge option={option} />
              {selected.has(option.id) && <IconCheck size={14} />}
            </Group>
          </Combobox.Option>
        ))}
        {query && !exactMatch && onUpdateConfig && (
          <Combobox.Option value="__create">
            <Group gap={6} wrap="nowrap">
              <IconPlus size={14} />
              {t("Create {{name}}", { name: search.trim() })}
            </Group>
          </Combobox.Option>
        )}
        {filtered.length === 0 && !query && (
          <Combobox.Empty>{t("No options")}</Combobox.Empty>
        )}
      </Combobox.Options>
    </Combobox>
  );
}

function DateEditor({ value, onChange, onClose }: PropertyEditorProps) {
  const { t } = useTranslation();
  const current = value as DateValue | null;
  const [range, setRange] = useState(Boolean(current?.end));
  const start = current?.start?.slice(0, 10) ?? null;
  const end = current?.end?.slice(0, 10) ?? null;

  return (
    <Stack gap="xs">
      {range ? (
        <DatePicker
          type="range"
          allowSingleDateInRange
          defaultValue={[start, end ?? start]}
          onChange={([from, to]) => {
            if (from && to) {
              onChange(from === to ? { start: from } : { start: from, end: to });
              onClose();
            }
          }}
        />
      ) : (
        <DatePicker
          defaultValue={start}
          onChange={(date) => {
            onChange(date ? { start: date } : null);
            onClose();
          }}
        />
      )}
      <Group justify="space-between">
        <Switch
          size="xs"
          label={t("End date")}
          checked={range}
          onChange={(e) => setRange(e.currentTarget.checked)}
        />
        <Button
          size="compact-xs"
          variant="subtle"
          color="gray"
          onClick={() => {
            onChange(null);
            onClose();
          }}
        >
          {t("Clear")}
        </Button>
      </Group>
    </Stack>
  );
}

function PersonEditor({ value, onChange, onClose }: PropertyEditorProps) {
  const { t } = useTranslation();
  const known = useMemberMap();
  const [draft, setDraft] = useState<string[]>((value as string[]) ?? []);
  const [search, setSearch] = useState("");
  const [query] = useDebouncedValue(search, 300);
  const { data: found } = useWorkspaceMembersQuery({ query, limit: 50 });

  // Keep already-selected people in the option list even when they are not
  // part of the current search result.
  const users = new Map(known);
  for (const user of found?.items ?? []) users.set(user.id, user);
  const data = [...users.values()].map((user) => ({
    value: user.id,
    label: user.name,
  }));

  return (
    <Stack gap="xs" w={280}>
      <MultiSelect
        autoFocus
        size="xs"
        searchable
        data={data}
        value={draft}
        searchValue={search}
        onSearchChange={setSearch}
        onChange={setDraft}
        placeholder={t("Search people")}
        comboboxProps={{ withinPortal: false }}
      />
      <Group justify="flex-end">
        <Button
          size="compact-xs"
          onClick={() => {
            onChange(draft);
            onClose();
          }}
        >
          {t("Save")}
        </Button>
      </Group>
    </Stack>
  );
}
