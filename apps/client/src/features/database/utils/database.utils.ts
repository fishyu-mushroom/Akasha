import {
  DateValue,
  IDatabaseProperty,
  IDatabaseView,
  PropertyType,
  PropertyValue,
  SelectOption,
  SYSTEM_PROPERTIES,
} from "@/features/database/types/database.types";

export const OPTION_COLORS = [
  "gray",
  "red",
  "orange",
  "yellow",
  "green",
  "teal",
  "blue",
  "violet",
  "pink",
];

export function newOptionId(): string {
  return Math.random().toString(36).slice(2, 10);
}

export function getOptions(property?: IDatabaseProperty): SelectOption[] {
  return property?.config?.options ?? [];
}

export function isEmptyValue(value: PropertyValue | undefined): boolean {
  return (
    value === null ||
    value === undefined ||
    value === "" ||
    (Array.isArray(value) && value.length === 0)
  );
}

export function formatDateValue(value?: DateValue | null): string {
  if (!value?.start) return "";
  return value.end && value.end !== value.start
    ? `${value.start.slice(0, 10)} → ${value.end.slice(0, 10)}`
    : value.start.slice(0, 10);
}

export function formatNumber(
  value: number,
  format?: "number" | "percent" | "currency",
): string {
  if (format === "percent") return `${value}%`;
  if (format === "currency") return value.toLocaleString(undefined, {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
  return value.toLocaleString();
}

/** Ordered columns for a view: title first, then visible properties. */
export function visibleProperties(
  view: IDatabaseView | undefined,
  properties: IDatabaseProperty[],
): IDatabaseProperty[] {
  const visible = view?.config?.visibleProperties;
  if (!visible) return properties;
  const byId = new Map(properties.map((p) => [p.id, p]));
  return visible
    .map((id) => byId.get(id))
    .filter((p): p is IDatabaseProperty => Boolean(p));
}

export function propertyLabel(
  id: string,
  properties: IDatabaseProperty[],
  t: (key: string) => string,
): string {
  switch (id) {
    case SYSTEM_PROPERTIES.TITLE:
      return t("Name");
    case SYSTEM_PROPERTIES.CREATED_TIME:
      return t("Created time");
    case SYSTEM_PROPERTIES.UPDATED_TIME:
      return t("Last edited time");
    case SYSTEM_PROPERTIES.CREATED_BY:
      return t("Created by");
  }
  return properties.find((p) => p.id === id)?.name ?? id;
}

export const PROPERTY_TYPE_LABELS: Record<PropertyType, string> = {
  text: "Text",
  number: "Number",
  select: "Select",
  multi_select: "Multi-select",
  status: "Status",
  date: "Date",
  person: "Person",
  checkbox: "Checkbox",
  url: "URL",
};

export const OPERATOR_LABELS: Record<string, string> = {
  equals: "Is",
  not_equals: "Is not",
  contains: "Contains",
  not_contains: "Does not contain",
  is_empty: "Is empty",
  is_not_empty: "Is not empty",
  gt: ">",
  gte: "≥",
  lt: "<",
  lte: "≤",
  on: "Is on",
  before: "Is before",
  after: "Is after",
  on_or_before: "Is on or before",
  on_or_after: "Is on or after",
};

/** Fractional position helpers delegate ordering to the server via neighbours. */
export function neighbours<T extends { id: string }>(
  list: T[],
  index: number,
): { afterPageId?: string; beforePageId?: string } {
  return {
    afterPageId: list[index - 1]?.id,
    beforePageId: list[index]?.id,
  };
}
