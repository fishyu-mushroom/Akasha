import { BadRequestException } from '@nestjs/common';
import {
  DATABASE_LIMITS,
  DateValue,
  PropertyConfig,
  PropertyType,
  PROPERTY_TYPES,
  SelectOption,
  STATUS_GROUPS,
} from './database.constants';

export interface PropertyDefinition {
  id: string;
  type: string;
  config: unknown;
}

const DATE_RE = /^\d{4}-\d{2}-\d{2}(T[\d:.]+(Z|[+-]\d{2}:\d{2})?)?$/;
const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function isPropertyType(type: string): type is PropertyType {
  return (PROPERTY_TYPES as readonly string[]).includes(type);
}

export function getOptions(config: unknown): SelectOption[] {
  const options = (config as PropertyConfig | null)?.options;
  return Array.isArray(options) ? options : [];
}

/**
 * Validates and normalizes a single property value. Returns `null` to clear
 * the value. Throws BadRequestException for invalid input.
 */
export function normalizePropertyValue(
  property: PropertyDefinition,
  value: unknown,
): unknown {
  if (value === null || value === undefined || value === '') return null;

  const fail = (): never => {
    throw new BadRequestException(
      `Invalid value for property ${property.id} (${property.type})`,
    );
  };

  switch (property.type) {
    case 'text':
    case 'url': {
      if (typeof value !== 'string') fail();
      const text = (value as string).slice(0, DATABASE_LIMITS.MAX_TEXT_LENGTH);
      if (property.type === 'url' && !/^https?:\/\//i.test(text)) fail();
      return text;
    }
    case 'number': {
      if (typeof value !== 'number' || !Number.isFinite(value)) fail();
      return value;
    }
    case 'checkbox': {
      if (typeof value !== 'boolean') fail();
      return value;
    }
    case 'select':
    case 'status': {
      if (typeof value !== 'string') fail();
      if (!getOptions(property.config).some((o) => o.id === value)) fail();
      return value;
    }
    case 'multi_select': {
      if (!Array.isArray(value)) fail();
      const ids = new Set(getOptions(property.config).map((o) => o.id));
      const list = [...new Set(value as unknown[])];
      if (list.some((v) => typeof v !== 'string' || !ids.has(v))) fail();
      return list.length ? list : null;
    }
    case 'person': {
      if (!Array.isArray(value)) fail();
      const list = [...new Set(value as unknown[])];
      if (list.some((v) => typeof v !== 'string' || !UUID_RE.test(v))) fail();
      return list.length ? list : null;
    }
    case 'date': {
      const date = value as DateValue;
      if (typeof date !== 'object' || typeof date.start !== 'string') fail();
      if (!DATE_RE.test(date.start) || Number.isNaN(Date.parse(date.start)))
        fail();
      if (date.end !== undefined && date.end !== null) {
        if (typeof date.end !== 'string' || !DATE_RE.test(date.end)) fail();
        if (Date.parse(date.end) < Date.parse(date.start)) fail();
        return { start: date.start, end: date.end };
      }
      return { start: date.start };
    }
    default:
      return fail();
  }
}

/**
 * Validates a patch of property values against the database schema. Values
 * set to `null` are returned in `removed` so callers can drop the keys.
 */
export function normalizePropertyPatch(
  properties: PropertyDefinition[],
  patch: Record<string, unknown>,
): { set: Record<string, unknown>; removed: string[] } {
  const byId = new Map(properties.map((p) => [p.id, p]));
  const set: Record<string, unknown> = {};
  const removed: string[] = [];

  for (const [id, raw] of Object.entries(patch ?? {})) {
    const property = byId.get(id);
    if (!property) {
      throw new BadRequestException(`Unknown property ${id}`);
    }
    const value = normalizePropertyValue(property, raw);
    if (value === null) removed.push(id);
    else set[id] = value;
  }

  return { set, removed };
}

/**
 * Validates select/status option lists. Option ids are kept stable so row
 * values survive renames.
 */
export function normalizePropertyConfig(
  type: string,
  config: unknown,
): PropertyConfig {
  const input = (config ?? {}) as PropertyConfig;
  const result: PropertyConfig = {};

  if (type === 'select' || type === 'multi_select' || type === 'status') {
    const options = Array.isArray(input.options) ? input.options : [];
    if (options.length > DATABASE_LIMITS.MAX_OPTIONS) {
      throw new BadRequestException('Too many options');
    }
    const seen = new Set<string>();
    result.options = options.map((option) => {
      if (
        !option ||
        typeof option.id !== 'string' ||
        !option.id ||
        option.id.length > 64 ||
        typeof option.name !== 'string' ||
        seen.has(option.id)
      ) {
        throw new BadRequestException('Invalid option');
      }
      seen.add(option.id);
      const normalized: SelectOption = {
        id: option.id,
        name: option.name.slice(0, 200),
      };
      if (typeof option.color === 'string') {
        normalized.color = option.color.slice(0, 32);
      }
      if (type === 'status') {
        normalized.group = (STATUS_GROUPS as readonly string[]).includes(
          option.group as string,
        )
          ? option.group
          : 'todo';
      }
      return normalized;
    });
  }

  if (type === 'number' && input.numberFormat) {
    if (!['number', 'percent', 'currency'].includes(input.numberFormat)) {
      throw new BadRequestException('Invalid number format');
    }
    result.numberFormat = input.numberFormat;
  }

  if (type === 'date' && typeof input.dateIncludeTime === 'boolean') {
    result.dateIncludeTime = input.dateIncludeTime;
  }

  return result;
}
