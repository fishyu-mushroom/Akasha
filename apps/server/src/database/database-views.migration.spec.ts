import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';

const readMigration = (name: string) =>
  readFile(resolve(__dirname, 'migrations', name), 'utf8');

describe('database views migration', () => {
  it('adds row columns to pages with guarded types', async () => {
    const source = await readMigration('20261021T100000-database-views.ts');

    expect(source).toContain("addColumn('type', 'varchar(16)'");
    expect(source).toContain("addColumn('database_id', 'uuid'");
    expect(source).toContain("addColumn('properties', 'jsonb'");
    expect(source).toContain("CHECK (type IN ('page', 'database'))");
    expect(source).toContain("CHECK (database_id IS NULL OR type = 'page')");
    expect(source).toContain('idx_pages_database_rows');
  });

  it('creates property and view tables cascading from the database page', async () => {
    const source = await readMigration('20261021T100000-database-views.ts');

    expect(source).toContain("createTable('database_properties')");
    expect(source).toContain("createTable('database_views')");
    expect(source).toContain("CHECK (type IN ('table', 'board', 'calendar'))");
    expect(source.match(/references\('pages\.id'\)\.onDelete\('cascade'\)/g))
      .toHaveLength(3);
  });

  it('reverts everything on rollback', async () => {
    const source = await readMigration('20261021T100000-database-views.ts');

    expect(source).toContain("dropTable('database_views')");
    expect(source).toContain("dropTable('database_properties')");
    expect(source).toContain('DROP INDEX IF EXISTS idx_pages_database_rows');
    expect(source).toContain(".dropColumn('database_id')");
  });
});

describe('drop unused knowledge columns migration', () => {
  it('does not rely on the unsupported dropColumn().ifExists() builder', async () => {
    const source = await readMigration(
      '20261020T100000-drop-unused-knowledge-columns.ts',
    );

    expect(source).not.toMatch(/dropColumn\([^)]*\)\s*\.ifExists\(\)/);
    expect(source).toContain('DROP COLUMN IF EXISTS attachment_id');
    expect(source).toContain('DROP COLUMN IF EXISTS result_quality');
  });
});
