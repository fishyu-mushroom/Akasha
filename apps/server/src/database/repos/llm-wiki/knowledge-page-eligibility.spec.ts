import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import {
  DummyDriver,
  Kysely,
  PostgresAdapter,
  PostgresIntrospector,
  PostgresQueryCompiler,
} from 'kysely';
import {
  isKnowledgeEligiblePage,
  knowledgeEligiblePageSql,
} from './knowledge-page-eligibility';

const db = new Kysely<any>({
  dialect: {
    createAdapter: () => new PostgresAdapter(),
    createDriver: () => new DummyDriver(),
    createIntrospector: (k) => new PostgresIntrospector(k),
    createQueryCompiler: () => new PostgresQueryCompiler(),
  },
});

describe('knowledge page eligibility', () => {
  it('excludes database pages and database rows', () => {
    expect(isKnowledgeEligiblePage({ type: 'page', databaseId: null })).toBe(
      true,
    );
    expect(isKnowledgeEligiblePage({})).toBe(true);
    expect(isKnowledgeEligiblePage({ type: 'database' })).toBe(false);
    expect(
      isKnowledgeEligiblePage({ type: 'page', databaseId: 'db-1' }),
    ).toBe(false);
  });

  it('compiles to a predicate on the given alias', () => {
    expect(knowledgeEligiblePageSql('source_page').compile(db).sql).toBe(
      `("source_page".type = 'page' AND "source_page".database_id IS NULL)`,
    );
  });

  // Every query that enumerates pages as compile sources must apply the
  // predicate; this guards against a new entry point silently skipping it.
  it.each([
    ['knowledge-space-execution.repo.ts', 1],
    ['knowledge-space-compilation.repo.ts', 5],
    ['../page/page.repo.ts', 2],
  ])('%s applies the predicate', async (file, count) => {
    const source = await readFile(resolve(__dirname, file), 'utf8');
    expect(source.match(/knowledgeEligiblePageSql\(/g)).toHaveLength(count);
  });

  it('treats ineligible pages as out of scope for retirement', async () => {
    const source = await readFile(
      resolve(
        __dirname,
        '../../../ee/llm-wiki/services/knowledge-source-retirement.service.ts',
      ),
      'utf8',
    );
    expect(source.match(/isKnowledgeEligiblePage\(/g)).toHaveLength(2);
  });
});
