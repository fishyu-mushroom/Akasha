import { useState } from "react";
import {
  ActionIcon,
  Button,
  Checkbox,
  Group,
  NumberInput,
  Popover,
  SegmentedControl,
  Select,
  Stack,
  Switch,
  Text,
  TextInput,
} from "@mantine/core";
import { DateInput } from "@mantine/dates";
import {
  IconAdjustmentsHorizontal,
  IconArrowsSort,
  IconFilter,
  IconPlus,
  IconX,
} from "@tabler/icons-react";
import { useTranslation } from "react-i18next";
import {
  FilterCondition,
  IDatabaseProperty,
  IDatabaseView,
  OPERATORS_BY_TYPE,
  SYSTEM_PROPERTIES,
  VALUELESS_OPERATORS,
  ViewSort,
} from "@/features/database/types/database.types";
import {
  getOptions,
  OPERATOR_LABELS,
  propertyLabel,
} from "@/features/database/utils/database.utils";
import { DatabaseActions } from "@/features/database/hooks/use-database-actions";
import { useMemberMap } from "./property-value";

interface ViewToolbarProps {
  view: IDatabaseView;
  properties: IDatabaseProperty[];
  editable: boolean;
  actions: DatabaseActions;
}

export function ViewToolbar({
  view,
  properties,
  editable,
  actions,
}: ViewToolbarProps) {
  const filterMode = view.config.filter?.or ? "or" : "and";
  const conditions = view.config.filter?.[filterMode] ?? [];
  const sorts = view.config.sorts ?? [];

  return (
    <Group gap={4}>
      <FilterPopover
        properties={properties}
        conditions={conditions}
        mode={filterMode}
        disabled={!editable}
        onChange={(next, mode) =>
          actions.updateViewConfig(view, {
            filter: next.length ? { [mode]: next } : undefined,
          })
        }
      />
      <SortPopover
        properties={properties}
        sorts={sorts}
        disabled={!editable}
        onChange={(next) => actions.updateViewConfig(view, { sorts: next })}
      />
      {view.type === "table" && (
        <VisibilityPopover
          view={view}
          properties={properties}
          disabled={!editable}
          onChange={(ids) =>
            actions.updateViewConfig(view, { visibleProperties: ids })
          }
        />
      )}
    </Group>
  );
}

function ToolbarButton({
  icon,
  label,
  count,
  onClick,
}: {
  icon: React.ReactNode;
  label: string;
  count?: number;
  onClick: () => void;
}) {
  return (
    <Button
      size="compact-sm"
      variant={count ? "light" : "subtle"}
      color={count ? undefined : "gray"}
      leftSection={icon}
      onClick={onClick}
    >
      {count ? `${label} · ${count}` : label}
    </Button>
  );
}

function FilterPopover({
  properties,
  conditions,
  mode,
  disabled,
  onChange,
}: {
  properties: IDatabaseProperty[];
  conditions: FilterCondition[];
  mode: "and" | "or";
  disabled: boolean;
  onChange: (conditions: FilterCondition[], mode: "and" | "or") => void;
}) {
  const { t } = useTranslation();
  // Edit locally; persist complete conditions when the popover closes so
  // typing does not hit the API on every keystroke.
  const [draft, setDraft] = useState<FilterCondition[]>(conditions);
  const [draftMode, setDraftMode] = useState(mode);
  const byId = new Map(properties.map((p) => [p.id, p]));
  const filterable = properties.map((p) => ({ value: p.id, label: p.name }));
  const typeOf = (id: string) =>
    id === SYSTEM_PROPERTIES.TITLE ? "text" : byId.get(id)?.type;

  const update = (index: number, patch: Partial<FilterCondition>) =>
    setDraft((list) =>
      list.map((c, i) => (i === index ? { ...c, ...patch } : c)),
    );

  const add = () => {
    const first = properties[0];
    const property = first?.id ?? SYSTEM_PROPERTIES.TITLE;
    const operator = OPERATORS_BY_TYPE[typeOf(property) ?? "text"][0];
    setDraft((list) => [
      ...list,
      { property, operator, value: defaultValue(typeOf(property)) },
    ]);
  };

  return (
    <Popover
      position="bottom-start"
      shadow="md"
      disabled={disabled}
      onOpen={() => {
        setDraft(conditions);
        setDraftMode(mode);
      }}
      onClose={() => {
        const complete = draft.filter(isCompleteCondition);
        if (
          JSON.stringify(complete) !== JSON.stringify(conditions) ||
          draftMode !== mode
        ) {
          onChange(complete, draftMode);
        }
      }}
    >
      <Popover.Target>
        <div>
          <ToolbarButton
            icon={<IconFilter size={14} />}
            label={t("Filter")}
            count={conditions.length}
            onClick={() => undefined}
          />
        </div>
      </Popover.Target>
      <Popover.Dropdown>
        <Stack gap="xs" miw={420}>
          {draft.length > 1 && (
            <SegmentedControl
              size="xs"
              value={draftMode}
              onChange={(value) => setDraftMode(value as "and" | "or")}
              data={[
                { value: "and", label: t("Match all") },
                { value: "or", label: t("Match any") },
              ]}
            />
          )}
          {draft.map((condition, index) => {
            const type = typeOf(condition.property) ?? "text";
            const property = byId.get(condition.property);
            return (
              <Group key={index} gap={6} wrap="nowrap">
                <Select
                  size="xs"
                  w={130}
                  aria-label={t("Property")}
                  data={[
                    { value: SYSTEM_PROPERTIES.TITLE, label: t("Name") },
                    ...filterable,
                  ]}
                  value={condition.property}
                  allowDeselect={false}
                  onChange={(value) => {
                    const nextType = typeOf(value!) ?? "text";
                    update(index, {
                      property: value!,
                      operator: OPERATORS_BY_TYPE[nextType][0],
                      value: defaultValue(nextType),
                    });
                  }}
                />
                <Select
                  size="xs"
                  w={130}
                  aria-label={t("Operator")}
                  data={OPERATORS_BY_TYPE[type].map((op) => ({
                    value: op,
                    label: t(OPERATOR_LABELS[op]),
                  }))}
                  value={condition.operator}
                  allowDeselect={false}
                  onChange={(value) => update(index, { operator: value! })}
                />
                {!VALUELESS_OPERATORS.includes(condition.operator) && (
                  <FilterValueInput
                    type={type}
                    property={property}
                    value={condition.value}
                    onChange={(value) => update(index, { value })}
                  />
                )}
                <ActionIcon
                  variant="subtle"
                  color="gray"
                  aria-label={t("Remove filter")}
                  onClick={() =>
                    setDraft((list) => list.filter((_, i) => i !== index))
                  }
                >
                  <IconX size={14} />
                </ActionIcon>
              </Group>
            );
          })}
          <Button
            size="compact-xs"
            variant="subtle"
            color="gray"
            leftSection={<IconPlus size={12} />}
            onClick={add}
            style={{ alignSelf: "flex-start" }}
          >
            {t("Add filter")}
          </Button>
        </Stack>
      </Popover.Dropdown>
    </Popover>
  );
}

function isCompleteCondition(condition: FilterCondition): boolean {
  if (VALUELESS_OPERATORS.includes(condition.operator)) return true;
  const { value } = condition;
  return value !== undefined && value !== null && value !== "";
}

function defaultValue(type?: string): unknown {
  if (type === "checkbox") return true;
  return undefined;
}

function FilterValueInput({
  type,
  property,
  value,
  onChange,
}: {
  type: string;
  property?: IDatabaseProperty;
  value: unknown;
  onChange: (value: unknown) => void;
}) {
  const { t } = useTranslation();
  const common = { size: "xs" as const, w: 140, "aria-label": t("Value") };

  switch (type) {
    case "number":
      return (
        <NumberInput
          {...common}
          value={typeof value === "number" ? value : ""}
          onChange={(v) => onChange(typeof v === "number" ? v : undefined)}
        />
      );
    case "checkbox":
      return (
        <Switch
          size="xs"
          aria-label={t("Value")}
          checked={value === true}
          onChange={(e) => onChange(e.currentTarget.checked)}
        />
      );
    case "select":
    case "status":
    case "multi_select":
      return (
        <Select
          {...common}
          data={getOptions(property).map((o) => ({ value: o.id, label: o.name }))}
          value={(value as string) ?? null}
          onChange={(v) => onChange(v ?? undefined)}
        />
      );
    case "person":
      return <PersonFilterInput {...common} value={value} onChange={onChange} />;
    case "date":
      return (
        <DateInput
          {...common}
          valueFormat="YYYY-MM-DD"
          value={(value as string) ?? null}
          onChange={(v) => onChange(v ?? undefined)}
        />
      );
    default:
      return (
        <TextInput
          {...common}
          value={(value as string) ?? ""}
          onChange={(e) => onChange(e.currentTarget.value)}
        />
      );
  }
}

function PersonFilterInput({
  value,
  onChange,
  ...common
}: {
  value: unknown;
  onChange: (value: unknown) => void;
  size: "xs";
  w: number;
  "aria-label": string;
}) {
  const members = useMemberMap();
  return (
    <Select
      {...common}
      searchable
      data={[...members.values()].map((u) => ({ value: u.id, label: u.name }))}
      value={(value as string) ?? null}
      onChange={(v) => onChange(v ?? undefined)}
    />
  );
}

function SortPopover({
  properties,
  sorts,
  disabled,
  onChange,
}: {
  properties: IDatabaseProperty[];
  sorts: ViewSort[];
  disabled: boolean;
  onChange: (sorts: ViewSort[]) => void;
}) {
  const { t } = useTranslation();
  const data = [
    SYSTEM_PROPERTIES.TITLE,
    SYSTEM_PROPERTIES.CREATED_TIME,
    SYSTEM_PROPERTIES.UPDATED_TIME,
    ...properties.filter((p) => p.type !== "person").map((p) => p.id),
  ].map((id) => ({ value: id, label: propertyLabel(id, properties, t) }));

  return (
    <Popover position="bottom-start" shadow="md" disabled={disabled}>
      <Popover.Target>
        <div>
          <ToolbarButton
            icon={<IconArrowsSort size={14} />}
            label={t("Sort")}
            count={sorts.length}
            onClick={() => undefined}
          />
        </div>
      </Popover.Target>
      <Popover.Dropdown>
        <Stack gap="xs" miw={320}>
          {sorts.map((sort, index) => (
            <Group key={index} gap={6} wrap="nowrap">
              <Select
                size="xs"
                w={160}
                aria-label={t("Property")}
                data={data}
                value={sort.property}
                allowDeselect={false}
                onChange={(value) =>
                  onChange(
                    sorts.map((s, i) =>
                      i === index ? { ...s, property: value! } : s,
                    ),
                  )
                }
              />
              <Select
                size="xs"
                w={110}
                aria-label={t("Direction")}
                data={[
                  { value: "asc", label: t("Ascending") },
                  { value: "desc", label: t("Descending") },
                ]}
                value={sort.direction}
                allowDeselect={false}
                onChange={(value) =>
                  onChange(
                    sorts.map((s, i) =>
                      i === index
                        ? { ...s, direction: value as "asc" | "desc" }
                        : s,
                    ),
                  )
                }
              />
              <ActionIcon
                variant="subtle"
                color="gray"
                aria-label={t("Remove sort")}
                onClick={() => onChange(sorts.filter((_, i) => i !== index))}
              >
                <IconX size={14} />
              </ActionIcon>
            </Group>
          ))}
          {sorts.length < 5 && (
            <Button
              size="compact-xs"
              variant="subtle"
              color="gray"
              leftSection={<IconPlus size={12} />}
              style={{ alignSelf: "flex-start" }}
              onClick={() =>
                onChange([
                  ...sorts,
                  { property: SYSTEM_PROPERTIES.TITLE, direction: "asc" },
                ])
              }
            >
              {t("Add sort")}
            </Button>
          )}
        </Stack>
      </Popover.Dropdown>
    </Popover>
  );
}

function VisibilityPopover({
  view,
  properties,
  disabled,
  onChange,
}: {
  view: IDatabaseView;
  properties: IDatabaseProperty[];
  disabled: boolean;
  onChange: (ids: string[]) => void;
}) {
  const { t } = useTranslation();
  const visible = view.config.visibleProperties ?? properties.map((p) => p.id);

  return (
    <Popover position="bottom-start" shadow="md" disabled={disabled}>
      <Popover.Target>
        <div>
          <ToolbarButton
            icon={<IconAdjustmentsHorizontal size={14} />}
            label={t("Properties")}
            onClick={() => undefined}
          />
        </div>
      </Popover.Target>
      <Popover.Dropdown>
        <Stack gap={6} miw={200}>
          <Text size="xs" c="dimmed">
            {t("Shown in table")}
          </Text>
          {properties.map((property) => (
            <Checkbox
              key={property.id}
              size="xs"
              label={property.name}
              checked={visible.includes(property.id)}
              onChange={(e) =>
                onChange(
                  e.currentTarget.checked
                    ? [...visible, property.id]
                    : visible.filter((id) => id !== property.id),
                )
              }
            />
          ))}
        </Stack>
      </Popover.Dropdown>
    </Popover>
  );
}
