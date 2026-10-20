import { type Kysely, sql } from 'kysely';

export async function up(db: Kysely<any>): Promise<void> {
  await db.schema
    .alterTable('pages')
    .addColumn('type', 'varchar(16)', (col) => col.notNull().defaultTo('page'))
    .addColumn('database_id', 'uuid', (col) =>
      col.references('pages.id').onDelete('cascade'),
    )
    .addColumn('properties', 'jsonb', (col) =>
      col.notNull().defaultTo(sql`'{}'::jsonb`),
    )
    .execute();

  await sql`
    ALTER TABLE pages
      ADD CONSTRAINT pages_type_check CHECK (type IN ('page', 'database')),
      ADD CONSTRAINT pages_database_row_type_check
        CHECK (database_id IS NULL OR type = 'page')
  `.execute(db);

  await sql`
    CREATE INDEX IF NOT EXISTS idx_pages_database_rows
      ON pages (database_id, position COLLATE "C")
      WHERE database_id IS NOT NULL AND deleted_at IS NULL
  `.execute(db);

  await db.schema
    .createTable('database_properties')
    .ifNotExists()
    .addColumn('id', 'uuid', (col) =>
      col.primaryKey().defaultTo(sql`gen_uuid_v7()`),
    )
    .addColumn('workspace_id', 'uuid', (col) =>
      col.notNull().references('workspaces.id').onDelete('cascade'),
    )
    .addColumn('database_id', 'uuid', (col) =>
      col.notNull().references('pages.id').onDelete('cascade'),
    )
    .addColumn('name', 'varchar(200)', (col) => col.notNull())
    .addColumn('type', 'varchar(32)', (col) => col.notNull())
    .addColumn('config', 'jsonb', (col) =>
      col.notNull().defaultTo(sql`'{}'::jsonb`),
    )
    .addColumn('position', 'varchar', (col) => col.notNull())
    .addColumn('created_at', 'timestamptz', (col) =>
      col.notNull().defaultTo(sql`now()`),
    )
    .addColumn('updated_at', 'timestamptz', (col) =>
      col.notNull().defaultTo(sql`now()`),
    )
    .execute();

  await sql`
    ALTER TABLE database_properties
      ADD CONSTRAINT database_properties_type_check
      CHECK (type IN ('text', 'number', 'select', 'multi_select', 'status',
        'date', 'person', 'checkbox', 'url'))
  `.execute(db);

  await db.schema
    .createIndex('idx_database_properties_database')
    .ifNotExists()
    .on('database_properties')
    .column('database_id')
    .execute();

  await db.schema
    .createTable('database_views')
    .ifNotExists()
    .addColumn('id', 'uuid', (col) =>
      col.primaryKey().defaultTo(sql`gen_uuid_v7()`),
    )
    .addColumn('workspace_id', 'uuid', (col) =>
      col.notNull().references('workspaces.id').onDelete('cascade'),
    )
    .addColumn('database_id', 'uuid', (col) =>
      col.notNull().references('pages.id').onDelete('cascade'),
    )
    .addColumn('name', 'varchar(200)', (col) => col.notNull())
    .addColumn('type', 'varchar(16)', (col) => col.notNull())
    .addColumn('config', 'jsonb', (col) =>
      col.notNull().defaultTo(sql`'{}'::jsonb`),
    )
    .addColumn('position', 'varchar', (col) => col.notNull())
    .addColumn('created_at', 'timestamptz', (col) =>
      col.notNull().defaultTo(sql`now()`),
    )
    .addColumn('updated_at', 'timestamptz', (col) =>
      col.notNull().defaultTo(sql`now()`),
    )
    .execute();

  await sql`
    ALTER TABLE database_views
      ADD CONSTRAINT database_views_type_check
      CHECK (type IN ('table', 'board', 'calendar'))
  `.execute(db);

  await db.schema
    .createIndex('idx_database_views_database')
    .ifNotExists()
    .on('database_views')
    .column('database_id')
    .execute();
}

export async function down(db: Kysely<any>): Promise<void> {
  await db.schema.dropTable('database_views').ifExists().execute();
  await db.schema.dropTable('database_properties').ifExists().execute();
  await sql`DROP INDEX IF EXISTS idx_pages_database_rows`.execute(db);
  await sql`
    ALTER TABLE pages
      DROP CONSTRAINT IF EXISTS pages_database_row_type_check,
      DROP CONSTRAINT IF EXISTS pages_type_check
  `.execute(db);
  await db.schema
    .alterTable('pages')
    .dropColumn('properties')
    .dropColumn('database_id')
    .dropColumn('type')
    .execute();
}
