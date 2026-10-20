import { IPage } from "@/features/page/types/page.types";

export type PropertyType =
  | "text"
  | "number"
  | "select"
  | "multi_select"
  | "status"
  | "date"
  | "person"
  | "checkbox"
  | "url";

export const PROPERTY_TYPES: PropertyType[] = [
  "text",
  "number",
  "select",
  "multi_select",
  "status",
  "date",
  "person",
  "checkbox",
  "url",
];

export type ViewType = "table" | "board" | "calendar";

export const SYSTEM_PROPERTIES = {
  TITLE: "__title",
  CREATED_TIME: "__created_time",
  UPDATED_TIME: "__updated_time",
  CREATED_BY: "__created_by",
} as const;

export type StatusGroup = "todo" | "in_progress" | "done";

export interface SelectOption {
  id: string;
  name: string;
  color?: string;
  group?: StatusGroup;
}

export interface PropertyConfig {
  options?: SelectOption[];
  numberFormat?: "number" | "percent" | "currency";
  dateIncludeTime?: boolean;
}

export interface IDatabaseProperty {
  id: string;
  databaseId: string;
  name: string;
  type: PropertyType;
  config: PropertyConfig;
  position: string;
}

export interface FilterCondition {
  property: string;
  operator: string;
  value?: unknown;
}

export interface ViewFilter {
  and?: FilterCondition[];
  or?: FilterCondition[];
}

export interface ViewSort {
  property: string;
  direction: "asc" | "desc";
}

export interface DatabaseViewConfig {
  filter?: ViewFilter;
  sorts?: ViewSort[];
  groupBy?: string;
  dateProperty?: string;
  visibleProperties?: string[];
  propertyWidths?: Record<string, number>;
}

export interface IDatabaseView {
  id: string;
  databaseId: string;
  name: string;
  type: ViewType;
  config: DatabaseViewConfig;
  position: string;
}

export interface DateValue {
  start: string;
  end?: string;
}

export type PropertyValue =
  | string
  | number
  | boolean
  | string[]
  | DateValue
  | null;

export interface IDatabaseRow {
  id: string;
  slugId: string;
  title: string | null;
  icon: string | null;
  position: string;
  parentPageId: string;
  databaseId: string;
  properties: Record<string, PropertyValue>;
  creatorId: string | null;
  lastUpdatedById: string | null;
  spaceId: string;
  createdAt: string;
  updatedAt: string;
}

export interface IDatabaseInfo {
  database: IPage;
  properties: IDatabaseProperty[];
  views: IDatabaseView[];
  rowCount: number;
  permissions?: { canEdit: boolean; hasRestriction: boolean };
}

export interface QueryRowsParams {
  databaseId: string;
  viewId?: string;
  filter?: ViewFilter;
  sorts?: ViewSort[];
  dateProperty?: string;
  rangeStart?: string;
  rangeEnd?: string;
  offset?: number;
  limit?: number;
}

export interface QueryRowsResult {
  items: IDatabaseRow[];
  total: number;
}

export const OPERATORS_BY_TYPE: Record<string, string[]> = {
  text: ["contains", "not_contains", "equals", "not_equals", "is_empty", "is_not_empty"],
  url: ["contains", "not_contains", "equals", "not_equals", "is_empty", "is_not_empty"],
  number: ["equals", "not_equals", "gt", "gte", "lt", "lte", "is_empty", "is_not_empty"],
  select: ["equals", "not_equals", "is_empty", "is_not_empty"],
  status: ["equals", "not_equals", "is_empty", "is_not_empty"],
  multi_select: ["contains", "not_contains", "is_empty", "is_not_empty"],
  person: ["contains", "not_contains", "is_empty", "is_not_empty"],
  date: ["on", "before", "after", "on_or_before", "on_or_after", "is_empty", "is_not_empty"],
  checkbox: ["equals"],
};

export const VALUELESS_OPERATORS = ["is_empty", "is_not_empty"];
