import { Injectable } from '@nestjs/common';
import { InjectKysely } from 'nestjs-kysely';
import { RawBuilder, sql, SqlBool } from 'kysely';
import { KyselyDB, KyselyTransaction } from '@akasha/db/types/kysely.types';
import {
  DatabaseProperty,
  DatabaseView,
  InsertableDatabaseProperty,
  InsertableDatabaseView,
  Page,
  UpdatableDatabaseProperty,
  UpdatableDatabaseView,
} from '@akasha/db/types/entity.types';
import { dbOrTx } from '@akasha/db/utils';
import { Json } from '@akasha/db/types/db';

/**
 * Binds a value as jsonb. postgres.js JSON-encodes parameters it infers as
 * jsonb, so a pre-stringified value bound to `$1::jsonb` would be stored as a
 * jsonb string scalar. Routing through text keeps it a real object/array.
 */
export const jsonb = (value: unknown): Json =>
  // Kysely accepts raw SQL for any column value; the generated Json column
  // types just don't model it.
  sql`${JSON.stringify(value)}::text::jsonb` as unknown as Json;

export const DATABASE_ROW_FIELDS = [
  'id',
  'slugId',
  'title',
  'icon',
  'position',
  'parentPageId',
  'databaseId',
  'properties',
  'creatorId',
  'lastUpdatedById',
  'spaceId',
  'workspaceId',
  'createdAt',
  'updatedAt',
] as const;

export type DatabaseRow = Pick<Page, (typeof DATABASE_ROW_FIELDS)[number]>;

@Injectable()
export class DatabaseRepo {
  constructor(@InjectKysely() private readonly db: KyselyDB) {}

  // Properties

  async findProperties(
    databaseId: string,
    trx?: KyselyTransaction,
  ): Promise<DatabaseProperty[]> {
    return dbOrTx(this.db, trx)
      .selectFrom('databaseProperties')
      .selectAll()
      .where('databaseId', '=', databaseId)
      .orderBy('position', (ob) => ob.collate('C').asc())
      .orderBy('id', 'asc')
      .execute();
  }

  async findPropertyById(
    propertyId: string,
    trx?: KyselyTransaction,
  ): Promise<DatabaseProperty | undefined> {
    return dbOrTx(this.db, trx)
      .selectFrom('databaseProperties')
      .selectAll()
      .where('id', '=', propertyId)
      .executeTakeFirst();
  }

  async insertProperty(
    property: InsertableDatabaseProperty,
    trx?: KyselyTransaction,
  ): Promise<DatabaseProperty> {
    return dbOrTx(this.db, trx)
      .insertInto('databaseProperties')
      .values(property)
      .returningAll()
      .executeTakeFirstOrThrow();
  }

  async updateProperty(
    propertyId: string,
    patch: UpdatableDatabaseProperty,
    trx?: KyselyTransaction,
  ): Promise<DatabaseProperty> {
    return dbOrTx(this.db, trx)
      .updateTable('databaseProperties')
      .set({ ...patch, updatedAt: new Date() })
      .where('id', '=', propertyId)
      .returningAll()
      .executeTakeFirstOrThrow();
  }

  async deleteProperty(
    propertyId: string,
    trx?: KyselyTransaction,
  ): Promise<void> {
    await dbOrTx(this.db, trx)
      .deleteFrom('databaseProperties')
      .where('id', '=', propertyId)
      .execute();
  }

  // Views

  async findViews(
    databaseId: string,
    trx?: KyselyTransaction,
  ): Promise<DatabaseView[]> {
    return dbOrTx(this.db, trx)
      .selectFrom('databaseViews')
      .selectAll()
      .where('databaseId', '=', databaseId)
      .orderBy('position', (ob) => ob.collate('C').asc())
      .orderBy('id', 'asc')
      .execute();
  }

  async findViewById(
    viewId: string,
    trx?: KyselyTransaction,
  ): Promise<DatabaseView | undefined> {
    return dbOrTx(this.db, trx)
      .selectFrom('databaseViews')
      .selectAll()
      .where('id', '=', viewId)
      .executeTakeFirst();
  }

  async insertView(
    view: InsertableDatabaseView,
    trx?: KyselyTransaction,
  ): Promise<DatabaseView> {
    return dbOrTx(this.db, trx)
      .insertInto('databaseViews')
      .values(view)
      .returningAll()
      .executeTakeFirstOrThrow();
  }

  async updateView(
    viewId: string,
    patch: UpdatableDatabaseView,
    trx?: KyselyTransaction,
  ): Promise<DatabaseView> {
    return dbOrTx(this.db, trx)
      .updateTable('databaseViews')
      .set({ ...patch, updatedAt: new Date() })
      .where('id', '=', viewId)
      .returningAll()
      .executeTakeFirstOrThrow();
  }

  async deleteView(viewId: string, trx?: KyselyTransaction): Promise<void> {
    await dbOrTx(this.db, trx)
      .deleteFrom('databaseViews')
      .where('id', '=', viewId)
      .execute();
  }

  // Rows

  async countRows(databaseId: string, trx?: KyselyTransaction) {
    const result = await dbOrTx(this.db, trx)
      .selectFrom('pages')
      .select((eb) => eb.fn.countAll<string>().as('count'))
      .where('databaseId', '=', databaseId)
      .where('deletedAt', 'is', null)
      .executeTakeFirst();
    return Number(result?.count ?? 0);
  }

  async queryRows(input: {
    databaseId: string;
    where: RawBuilder<SqlBool>[];
    orderBy: RawBuilder<unknown>[];
    offset: number;
    limit: number;
  }): Promise<{ items: DatabaseRow[]; total: number }> {
    const base = this.db
      .selectFrom('pages')
      .where('pages.databaseId', '=', input.databaseId)
      .where('pages.deletedAt', 'is', null)
      .$call((qb) =>
        input.where.reduce((acc, cond) => acc.where(cond), qb),
      );

    const [items, total] = await Promise.all([
      base
        .select(DATABASE_ROW_FIELDS.map((f) => `pages.${f}` as const))
        .orderBy(sql.join(input.orderBy))
        .offset(input.offset)
        .limit(input.limit)
        .execute(),
      base
        .select((eb) => eb.fn.countAll<string>().as('count'))
        .executeTakeFirst(),
    ]);

    return { items: items as DatabaseRow[], total: Number(total?.count ?? 0) };
  }

  async findRowById(
    pageId: string,
    trx?: KyselyTransaction,
  ): Promise<DatabaseRow | undefined> {
    return dbOrTx(this.db, trx)
      .selectFrom('pages')
      .select([...DATABASE_ROW_FIELDS])
      .where('id', '=', pageId)
      .where('deletedAt', 'is', null)
      .executeTakeFirst() as Promise<DatabaseRow | undefined>;
  }

  async lastRowPosition(databaseId: string, trx?: KyselyTransaction) {
    const row = await dbOrTx(this.db, trx)
      .selectFrom('pages')
      .select('position')
      .where('parentPageId', '=', databaseId)
      .where('deletedAt', 'is', null)
      .orderBy('position', (ob) => ob.collate('C').desc())
      .limit(1)
      .executeTakeFirst();
    return row?.position ?? null;
  }

  /**
   * Merges `set` into the row's properties and drops `removed` keys. Does not
   * emit PAGE_UPDATED: property edits must not trigger search reindexing or
   * knowledge compilation.
   */
  async updateRowProperties(input: {
    pageId: string;
    set: Record<string, unknown>;
    removed: string[];
    userId: string;
    position?: string;
    trx?: KyselyTransaction;
  }): Promise<DatabaseRow> {
    const removedKeys = sql`${input.removed}::text[]`;
    return dbOrTx(this.db, input.trx)
      .updateTable('pages')
      .set({
        properties: sql`(properties - ${removedKeys}) || ${jsonb(input.set)}`,
        lastUpdatedById: input.userId,
        updatedAt: new Date(),
        ...(input.position ? { position: input.position } : {}),
      })
      .where('id', '=', input.pageId)
      .returning([...DATABASE_ROW_FIELDS])
      .executeTakeFirstOrThrow() as Promise<DatabaseRow>;
  }

  /** Removes a property's value from every row of the database. */
  async removePropertyFromRows(
    databaseId: string,
    propertyId: string,
    trx?: KyselyTransaction,
  ): Promise<void> {
    await dbOrTx(this.db, trx)
      .updateTable('pages')
      .set({ properties: sql`properties - ${propertyId}::text` })
      .where('databaseId', '=', databaseId)
      .where(sql<SqlBool>`properties ? ${propertyId}`)
      .execute();
  }

  /** Clears references to removed select/status/multi-select options. */
  async removeOptionsFromRows(input: {
    databaseId: string;
    propertyId: string;
    optionIds: string[];
    multi: boolean;
    trx?: KyselyTransaction;
  }): Promise<void> {
    if (input.optionIds.length === 0) return;
    const { propertyId, optionIds } = input;
    const ids = sql`${optionIds}::text[]`;
    const db = dbOrTx(this.db, input.trx);

    if (!input.multi) {
      await db
        .updateTable('pages')
        .set({ properties: sql`properties - ${propertyId}::text` })
        .where('databaseId', '=', input.databaseId)
        .where(sql<SqlBool>`properties->>${propertyId} = ANY(${ids})`)
        .execute();
      return;
    }

    await db
      .updateTable('pages')
      .set({
        properties: sql`jsonb_set(properties, ARRAY[${propertyId}::text], coalesce(
          (SELECT jsonb_agg(v) FROM jsonb_array_elements_text(properties->${propertyId}) v
            WHERE v <> ALL(${ids})),
          '[]'::jsonb))`,
      })
      .where('databaseId', '=', input.databaseId)
      .where(sql<SqlBool>`jsonb_typeof(properties->${propertyId}) = 'array'`)
      .where(sql<SqlBool>`(properties->${propertyId}) ?| ${ids}`)
      .execute();
  }
}
