export const PAGE_TYPE = {
  PAGE: 'page',
  DATABASE: 'database',
} as const;

export const PROPERTY_TYPES = [
  'text',
  'number',
  'select',
  'multi_select',
  'status',
  'date',
  'person',
  'checkbox',
  'url',
] as const;
export type PropertyType = (typeof PROPERTY_TYPES)[number];

export const VIEW_TYPES = ['table', 'board', 'calendar'] as const;
export type ViewType = (typeof VIEW_TYPES)[number];

// System properties are read from page columns and never stored in
// pages.properties.
export const SYSTEM_PROPERTIES = {
  TITLE: '__title',
  CREATED_TIME: '__created_time',
  UPDATED_TIME: '__updated_time',
  CREATED_BY: '__created_by',
} as const;
export type SystemPropertyId =
  (typeof SYSTEM_PROPERTIES)[keyof typeof SYSTEM_PROPERTIES];
export const SYSTEM_PROPERTY_IDS: readonly string[] =
  Object.values(SYSTEM_PROPERTIES);

export const DATABASE_LIMITS = {
  MAX_ROWS: 5000,
  MAX_PROPERTIES: 50,
  MAX_VIEWS: 20,
  MAX_OPTIONS: 100,
  MAX_FILTERS: 20,
  MAX_SORTS: 5,
  MAX_QUERY_LIMIT: 200,
  MAX_TEXT_LENGTH: 10000,
} as const;

export const STATUS_GROUPS = ['todo', 'in_progress', 'done'] as const;
export type StatusGroup = (typeof STATUS_GROUPS)[number];

export interface SelectOption {
  id: string;
  name: string;
  color?: string;
  group?: StatusGroup;
}

export interface PropertyConfig {
  options?: SelectOption[];
  numberFormat?: 'number' | 'percent' | 'currency';
  dateIncludeTime?: boolean;
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
  direction: 'asc' | 'desc';
}

export interface DatabaseViewConfig {
  filter?: ViewFilter;
  sorts?: ViewSort[];
  groupBy?: string;
  dateProperty?: string;
  visibleProperties?: string[];
  propertyWidths?: Record<string, number>;
}

export interface DateValue {
  start: string;
  end?: string;
}

export const DEFAULT_STATUS_OPTIONS: SelectOption[] = [
  { id: 'todo', name: 'Not started', color: 'gray', group: 'todo' },
  { id: 'in_progress', name: 'In progress', color: 'blue', group: 'in_progress' },
  { id: 'done', name: 'Done', color: 'green', group: 'done' },
];
