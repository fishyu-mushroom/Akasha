import { BadRequestException } from '@nestjs/common';
import { RawBuilder, sql, SqlBool } from 'kysely';
import {
  DATABASE_LIMITS,
  FilterCondition,
  SYSTEM_PROPERTIES,
  ViewFilter,
  ViewSort,
} from './database.constants';
import { PropertyDefinition } from './database-values';

/**
 * Compiles view filters/sorts into parameterized SQL over the `pages` table.
 * Property ids are only ever bound as parameters after being checked against
 * the database schema; no user-provided string is spliced into SQL.
 */

type Kind =
  | 'text'
  | 'number'
  | 'select'
  | 'multi'
  | 'date'
  | 'checkbox'
  | 'timestamp'
  | 'user';

interface ResolvedProperty {
  kind: Kind;
  // Scalar expression used for comparison and sorting.
  expr: RawBuilder<unknown>;
  // Raw jsonb expression for containment checks (multi kinds only).
  json?: RawBuilder<unknown>;
}

const OPERATORS: Record<Kind, readonly string[]> = {
  text: ['equals', 'not_equals', 'contains', 'not_contains', 'is_empty', 'is_not_empty'],
  number: ['equals', 'not_equals', 'gt', 'gte', 'lt', 'lte', 'is_empty', 'is_not_empty'],
  select: ['equals', 'not_equals', 'is_empty', 'is_not_empty'],
  multi: ['contains', 'not_contains', 'is_empty', 'is_not_empty'],
  date: ['on', 'before', 'after', 'on_or_before', 'on_or_after', 'is_empty', 'is_not_empty'],
  checkbox: ['equals'],
  timestamp: ['on', 'before', 'after', 'on_or_before', 'on_or_after'],
  user: ['equals', 'not_equals'],
};

const DATE_ONLY_RE = /^\d{4}-\d{2}-\d{2}$/;
const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export class DatabaseQueryBuilder {
  private readonly properties: Map<string, PropertyDefinition>;

  constructor(properties: PropertyDefinition[]) {
    this.properties = new Map(properties.map((p) => [p.id, p]));
  }

  resolve(propertyId: string): ResolvedProperty {
    switch (propertyId) {
      case SYSTEM_PROPERTIES.TITLE:
        return { kind: 'text', expr: sql`pages.title` };
      case SYSTEM_PROPERTIES.CREATED_TIME:
        return { kind: 'timestamp', expr: sql`pages.created_at` };
      case SYSTEM_PROPERTIES.UPDATED_TIME:
        return { kind: 'timestamp', expr: sql`pages.updated_at` };
      case SYSTEM_PROPERTIES.CREATED_BY:
        return { kind: 'user', expr: sql`pages.creator_id::text` };
    }

    const property = this.properties.get(propertyId);
    if (!property) {
      throw new BadRequestException(`Unknown property ${propertyId}`);
    }
    const id = property.id;

    switch (property.type) {
      case 'text':
      case 'url':
        return { kind: 'text', expr: sql`pages.properties->>${id}` };
      case 'number':
        return {
          kind: 'number',
          expr: sql`(pages.properties->>${id})::numeric`,
        };
      case 'checkbox':
        return {
          kind: 'checkbox',
          expr: sql`coalesce((pages.properties->>${id})::boolean, false)`,
        };
      case 'select':
      case 'status':
        return { kind: 'select', expr: sql`pages.properties->>${id}` };
      case 'multi_select':
      case 'person':
        return {
          kind: 'multi',
          expr: sql`(pages.properties->${id})->>0`,
          json: sql`pages.properties->${id}`,
        };
      case 'date':
        return {
          kind: 'date',
          expr: sql`left(pages.properties->${id}->>'start', 10)`,
        };
      default:
        throw new BadRequestException(`Unsupported property ${propertyId}`);
    }
  }

  buildWhere(filter?: ViewFilter): RawBuilder<SqlBool> | null {
    if (!filter) return null;
    if (filter.and && filter.or) {
      throw new BadRequestException('Filter must use either and or or');
    }
    const conditions = filter.and ?? filter.or ?? [];
    if (!Array.isArray(conditions)) {
      throw new BadRequestException('Invalid filter');
    }
    if (conditions.length > DATABASE_LIMITS.MAX_FILTERS) {
      throw new BadRequestException('Too many filters');
    }
    if (conditions.length === 0) return null;

    const parts = conditions.map((c) => this.buildCondition(c));
    const joiner = filter.or ? sql` OR ` : sql` AND `;
    return sql<SqlBool>`(${sql.join(parts, joiner)})`;
  }

  buildCondition(condition: FilterCondition): RawBuilder<SqlBool> {
    if (!condition || typeof condition.property !== 'string') {
      throw new BadRequestException('Invalid filter condition');
    }
    const resolved = this.resolve(condition.property);
    const { operator, value } = condition;
    if (!OPERATORS[resolved.kind].includes(operator)) {
      throw new BadRequestException(
        `Operator ${operator} is not supported for ${condition.property}`,
      );
    }

    const { expr } = resolved;

    if (operator === 'is_empty' || operator === 'is_not_empty') {
      const empty =
        resolved.kind === 'multi'
          ? sql<SqlBool>`coalesce(jsonb_array_length(${resolved.json}), 0) = 0`
          : resolved.kind === 'text'
            ? sql<SqlBool>`coalesce(${expr}, '') = ''`
            : sql<SqlBool>`${expr} IS NULL`;
      return operator === 'is_empty' ? empty : sql<SqlBool>`NOT (${empty})`;
    }

    switch (resolved.kind) {
      case 'text': {
        const text = expectString(value, condition.property);
        if (operator === 'equals') return sql<SqlBool>`${expr} = ${text}`;
        if (operator === 'not_equals')
          return sql<SqlBool>`${expr} IS DISTINCT FROM ${text}`;
        const pattern = `%${escapeLike(text)}%`;
        const like = sql<SqlBool>`coalesce(${expr}, '') ILIKE ${pattern}`;
        return operator === 'contains' ? like : sql<SqlBool>`NOT (${like})`;
      }
      case 'number': {
        if (typeof value !== 'number' || !Number.isFinite(value)) {
          throw new BadRequestException('Number filter requires a number');
        }
        const op = { equals: '=', gt: '>', gte: '>=', lt: '<', lte: '<=' }[
          operator
        ];
        if (operator === 'not_equals')
          return sql<SqlBool>`${expr} IS DISTINCT FROM ${value}`;
        return sql<SqlBool>`${expr} ${sql.raw(op)} ${value}`;
      }
      case 'select':
      case 'user': {
        const text = expectString(value, condition.property);
        if (resolved.kind === 'user' && !UUID_RE.test(text)) {
          throw new BadRequestException('Invalid user id');
        }
        return operator === 'equals'
          ? sql<SqlBool>`${expr} = ${text}`
          : sql<SqlBool>`${expr} IS DISTINCT FROM ${text}`;
      }
      case 'multi': {
        const text = expectString(value, condition.property);
        const contains = sql<SqlBool>`coalesce(${resolved.json} @> ${JSON.stringify([text])}::text::jsonb, false)`;
        return operator === 'contains'
          ? contains
          : sql<SqlBool>`NOT (${contains})`;
      }
      case 'checkbox': {
        if (typeof value !== 'boolean') {
          throw new BadRequestException('Checkbox filter requires a boolean');
        }
        return sql<SqlBool>`${expr} = ${value}`;
      }
      case 'date':
      case 'timestamp': {
        const date = expectString(value, condition.property);
        if (!DATE_ONLY_RE.test(date)) {
          throw new BadRequestException('Date filter requires YYYY-MM-DD');
        }
        const day =
          resolved.kind === 'timestamp'
            ? sql`to_char(${expr} AT TIME ZONE 'UTC', 'YYYY-MM-DD')`
            : expr;
        const op = {
          on: '=',
          before: '<',
          after: '>',
          on_or_before: '<=',
          on_or_after: '>=',
        }[operator];
        return sql<SqlBool>`${day} ${sql.raw(op)} ${date}`;
      }
    }
  }

  /** Rows whose date range overlaps [start, end] (inclusive, YYYY-MM-DD). */
  buildDateRange(
    propertyId: string,
    start: string,
    end: string,
  ): RawBuilder<SqlBool> {
    const property = this.properties.get(propertyId);
    if (!property || property.type !== 'date') {
      throw new BadRequestException('Date range requires a date property');
    }
    if (!DATE_ONLY_RE.test(start) || !DATE_ONLY_RE.test(end) || start > end) {
      throw new BadRequestException('Invalid date range');
    }
    const id = property.id;
    const rowStart = sql`left(pages.properties->${id}->>'start', 10)`;
    const rowEnd = sql`coalesce(left(pages.properties->${id}->>'end', 10), ${rowStart})`;
    return sql<SqlBool>`(${rowStart} <= ${end} AND ${rowEnd} >= ${start})`;
  }

  buildOrderBy(sorts?: ViewSort[]): RawBuilder<unknown>[] {
    const list = sorts ?? [];
    if (!Array.isArray(list) || list.length > DATABASE_LIMITS.MAX_SORTS) {
      throw new BadRequestException('Invalid sorts');
    }
    const items = list.map((sort) => {
      if (sort?.direction !== 'asc' && sort?.direction !== 'desc') {
        throw new BadRequestException('Invalid sort direction');
      }
      const { expr } = this.resolve(sort.property);
      return sql`${expr} ${sql.raw(sort.direction)} NULLS LAST`;
    });
    // Stable tie-breakers keep offset pagination deterministic.
    items.push(sql`pages.position COLLATE "C" asc`, sql`pages.id asc`);
    return items;
  }
}

function expectString(value: unknown, property: string): string {
  if (typeof value !== 'string' || value.length > 1000) {
    throw new BadRequestException(`Filter on ${property} requires a string`);
  }
  return value;
}

function escapeLike(value: string): string {
  return value.replace(/[\\%_]/g, (c) => `\\${c}`);
}
