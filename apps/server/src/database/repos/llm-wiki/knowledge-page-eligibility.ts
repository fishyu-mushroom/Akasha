import { sql } from 'kysely';

/**
 * Single source of truth for which pages may enter knowledge compilation.
 *
 * Phase 1 of database views keeps every database page and every database row
 * out of the knowledge base. Every query that enumerates `pages` as compile
 * sources must apply this predicate.
 */
export function knowledgeEligiblePageSql(alias: string) {
  const table = sql.ref(alias);
  return sql<boolean>`(${table}.type = 'page' AND ${table}.database_id IS NULL)`;
}

export function isKnowledgeEligiblePage(page: {
  type?: string | null;
  databaseId?: string | null;
}): boolean {
  return (page.type ?? 'page') === 'page' && !page.databaseId;
}
