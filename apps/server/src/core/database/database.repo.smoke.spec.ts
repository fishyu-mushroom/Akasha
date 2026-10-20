// Temporary local smoke test against the dev database. Run with DB_SMOKE=1.
// Everything runs inside a transaction that is rolled back.
import { CamelCasePlugin, Kysely, sql } from 'kysely';
import { PostgresJSDialect } from 'kysely-postgres-js';
import * as postgres from 'postgres';
import { config } from 'dotenv';
import { resolve } from 'node:path';
import { normalizePostgresUrl } from '../../common/helpers';
import { DatabaseRepo, jsonb } from '@akasha/db/repos/database/database.repo';
import { DatabaseQueryBuilder } from './database-query.builder';
import { knowledgeEligiblePageSql } from '@akasha/db/repos/llm-wiki/knowledge-page-eligibility';

const run = process.env.DB_SMOKE ? describe : describe.skip;

run('database repo smoke (real postgres)', () => {
  config({ path: resolve(__dirname, '../../../../../.env') });
  const client = postgres(normalizePostgresUrl(process.env.DATABASE_URL));
  const db = new Kysely<any>({
    dialect: new PostgresJSDialect({ postgres: client }),
    plugins: [new CamelCasePlugin()],
  });

  afterAll(() => db.destroy());

  it('queries, patches and cleans row properties', async () => {
    const rollback = new Error('rollback');
    await db
      .transaction()
      .execute(async (trx) => {
        const page = await trx
          .selectFrom('pages')
          .select(['spaceId', 'workspaceId'])
          .where('deletedAt', 'is', null)
          .limit(1)
          .executeTakeFirstOrThrow();

        const database = await trx
          .insertInto('pages')
          .values({
            slugId: 'smoke-db',
            title: 'DB',
            spaceId: page.spaceId,
            workspaceId: page.workspaceId,
            type: 'database',
            position: 'a0',
          })
          .returning('id')
          .executeTakeFirstOrThrow();

        const props = [
          { id: 'tags', type: 'multi_select', config: {} },
          { id: 'status', type: 'status', config: {} },
          { id: 'due', type: 'date', config: {} },
          { id: 'n', type: 'number', config: {} },
        ];
        for (const [i, properties] of [
          { tags: ['x', 'y'], status: 'todo', due: { start: '2026-10-05' }, n: 2 },
          { tags: ['y'], status: 'done', due: { start: '2026-09-28', end: '2026-10-02' }, n: 5 },
          { status: 'todo' },
        ].entries()) {
          await trx
            .insertInto('pages')
            .values({
              slugId: `smoke-row-${i}`,
              title: `Row ${i}`,
              spaceId: page.spaceId,
              workspaceId: page.workspaceId,
              parentPageId: database.id,
              databaseId: database.id,
              properties: jsonb(properties),
              position: `a${i + 1}`,
            })
            .execute();
        }

        const repo = new DatabaseRepo(trx as any);
        const builder = new DatabaseQueryBuilder(props);
        const query = (filter: any, sorts?: any) =>
          repo.queryRows({
            databaseId: database.id,
            where: [builder.buildWhere(filter)].filter(Boolean),
            orderBy: builder.buildOrderBy(sorts),
            offset: 0,
            limit: 50,
          });

        expect(
          (await query({ and: [{ property: 'tags', operator: 'contains', value: 'x' }] })).total,
        ).toBe(1);
        expect(
          (await query({ and: [{ property: 'tags', operator: 'is_empty' }] })).total,
        ).toBe(1);
        expect(
          (await query({ and: [{ property: 'n', operator: 'gt', value: 3 }] })).total,
        ).toBe(1);
        expect(
          (await query({ and: [{ property: 'status', operator: 'not_equals', value: 'done' }] })).total,
        ).toBe(2);
        const sorted = await query(undefined, [{ property: 'n', direction: 'desc' }]);
        expect(sorted.items.map((r) => r.title)).toEqual(['Row 1', 'Row 0', 'Row 2']);

        const october = await repo.queryRows({
          databaseId: database.id,
          where: [builder.buildDateRange('due', '2026-10-01', '2026-10-31')],
          orderBy: builder.buildOrderBy(),
          offset: 0,
          limit: 50,
        });
        expect(october.items.map((r) => r.title)).toEqual(['Row 0', 'Row 1']);

        const row = sorted.items[0];
        const patched = await repo.updateRowProperties({
          pageId: row.id,
          set: { n: 9 },
          removed: ['due'],
          userId: null,
          trx: trx as any,
        });
        expect(patched.properties).toEqual({ tags: ['y'], status: 'done', n: 9 });

        await repo.removeOptionsFromRows({
          databaseId: database.id,
          propertyId: 'tags',
          optionIds: ['y'],
          multi: true,
          trx: trx as any,
        });
        await repo.removeOptionsFromRows({
          databaseId: database.id,
          propertyId: 'status',
          optionIds: ['todo'],
          multi: false,
          trx: trx as any,
        });
        await repo.removePropertyFromRows(database.id, 'n', trx as any);

        const rows = await trx
          .selectFrom('pages')
          .select(['title', 'properties'])
          .where('databaseId', '=', database.id)
          .orderBy('position')
          .execute();
        expect(rows.map((r) => r.properties)).toEqual([
          { tags: ['x'], due: { start: '2026-10-05' } },
          { tags: [], status: 'done' },
          {},
        ]);

        // Knowledge eligibility: neither the database nor its rows qualify.
        const eligible = await trx
          .selectFrom('pages')
          .select('id')
          .where((eb) =>
            eb.or([
              eb('id', '=', database.id),
              eb('databaseId', '=', database.id),
            ]),
          )
          .where(knowledgeEligiblePageSql('pages'))
          .execute();
        expect(eligible).toEqual([]);

        throw rollback;
      })
      .catch((err) => {
        if (err !== rollback) throw err;
      });
  });
});
