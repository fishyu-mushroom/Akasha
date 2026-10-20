import { BadRequestException } from '@nestjs/common';
import {
  DummyDriver,
  Kysely,
  PostgresAdapter,
  PostgresIntrospector,
  PostgresQueryCompiler,
  RawBuilder,
} from 'kysely';
import { DatabaseQueryBuilder } from './database-query.builder';

const db = new Kysely<any>({
  dialect: {
    createAdapter: () => new PostgresAdapter(),
    createDriver: () => new DummyDriver(),
    createIntrospector: (k) => new PostgresIntrospector(k),
    createQueryCompiler: () => new PostgresQueryCompiler(),
  },
});

const compile = (expr: RawBuilder<unknown>) => expr.compile(db);

const properties = [
  { id: 'p_text', type: 'text', config: {} },
  { id: 'p_num', type: 'number', config: {} },
  { id: 'p_status', type: 'status', config: {} },
  { id: 'p_tags', type: 'multi_select', config: {} },
  { id: 'p_date', type: 'date', config: {} },
  { id: 'p_done', type: 'checkbox', config: {} },
];

describe('DatabaseQueryBuilder', () => {
  const builder = new DatabaseQueryBuilder(properties);

  it('binds property ids and values as parameters', () => {
    const where = builder.buildWhere({
      and: [
        { property: 'p_text', operator: 'contains', value: "50%_off'" },
        { property: 'p_num', operator: 'gte', value: 3 },
      ],
    });
    const { sql, parameters } = compile(where);

    expect(sql).not.toContain('p_text');
    expect(sql).not.toContain("50%");
    expect(sql).toContain(' AND ');
    expect(parameters).toEqual(['p_text', '%50\\%\\_off\'%', 'p_num', 3]);
  });

  it('joins or-filters with OR', () => {
    const where = builder.buildWhere({
      or: [
        { property: 'p_status', operator: 'equals', value: 'done' },
        { property: 'p_done', operator: 'equals', value: true },
      ],
    });
    expect(compile(where).sql).toContain(' OR ');
  });

  it('uses jsonb containment for multi-select', () => {
    const { sql, parameters } = compile(
      builder.buildCondition({
        property: 'p_tags',
        operator: 'contains',
        value: 'opt1',
      }),
    );
    expect(sql).toContain('@>');
    expect(parameters).toContain('["opt1"]');
  });

  it('compares dates at day precision', () => {
    const { sql, parameters } = compile(
      builder.buildCondition({
        property: 'p_date',
        operator: 'on_or_after',
        value: '2026-10-01',
      }),
    );
    expect(sql).toContain('left(');
    expect(sql).toContain('>=');
    expect(parameters).toContain('2026-10-01');
  });

  it('maps system properties to page columns', () => {
    const { sql } = compile(
      builder.buildCondition({
        property: '__title',
        operator: 'is_empty',
      }),
    );
    expect(sql).toContain('pages.title');
  });

  it('builds an overlapping date range', () => {
    const { sql, parameters } = compile(
      builder.buildDateRange('p_date', '2026-10-01', '2026-10-31'),
    );
    expect(sql).toContain("->>'end'");
    expect(parameters).toEqual(
      expect.arrayContaining(['2026-10-31', '2026-10-01']),
    );
  });

  it('appends stable tie-breakers to sorts', () => {
    const order = builder
      .buildOrderBy([{ property: 'p_num', direction: 'desc' }])
      .map((item) => compile(item).sql);
    expect(order[0]).toContain('desc NULLS LAST');
    expect(order.slice(-2)).toEqual([
      'pages.position COLLATE "C" asc',
      'pages.id asc',
    ]);
  });

  it.each([
    [{ property: 'unknown', operator: 'equals', value: 'x' }],
    [{ property: 'p_num', operator: 'contains', value: 'x' }],
    [{ property: 'p_num', operator: 'gt', value: '1; drop table pages' }],
    [{ property: 'p_date', operator: 'on', value: '2026-10-01 or 1=1' }],
    [{ property: 'p_done', operator: 'equals', value: 'true' }],
    [{ property: '__created_by', operator: 'equals', value: 'not-a-uuid' }],
  ])('rejects invalid condition %j', (condition) => {
    expect(() => builder.buildCondition(condition)).toThrow(
      BadRequestException,
    );
  });

  it('rejects invalid sort direction and mixed and/or', () => {
    expect(() =>
      builder.buildOrderBy([
        { property: 'p_num', direction: 'desc; drop' as 'desc' },
      ]),
    ).toThrow(BadRequestException);
    expect(() => builder.buildWhere({ and: [], or: [] })).toThrow(
      BadRequestException,
    );
  });
});
