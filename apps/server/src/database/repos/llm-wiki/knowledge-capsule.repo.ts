import { Injectable } from '@nestjs/common';
import { InjectKysely } from 'nestjs-kysely';
import { KyselyDB, KyselyTransaction } from '@docmost/db/types/kysely.types';
import { dbOrTx } from '@docmost/db/utils';
import {
  InsertableKnowledgePage,
  InsertableKnowledgePageSource,
  InsertableKnowledgeClaim,
  InsertableKnowledgeClaimSource,
  InsertableKnowledgeChunk,
  InsertableKnowledgeChunkSource,
  InsertableKnowledgeLink,
  InsertableKnowledgeLinkSource,
  InsertableKnowledgeGraphEdge,
  InsertableKnowledgeGraphEdgeSource,
  KnowledgeChunk,
  KnowledgeGraphEdge,
  KnowledgeGraphEdgeSource,
  KnowledgeLink,
  KnowledgeLinkSource,
  KnowledgePage,
  KnowledgePageSource,
} from '@docmost/db/types/entity.types';
import { sql } from 'kysely';

type SourcePageRow = { sourcePageId: string };
type OwnerRow<K extends string> = Record<K, string>;
export type UpsertCompiledArtifactInput = {
  page: InsertableKnowledgePage;
  pageSources?: InsertableKnowledgePageSource[];
  claims?: InsertableKnowledgeClaim[];
  claimSources?: InsertableKnowledgeClaimSource[];
  chunks?: InsertableKnowledgeChunk[];
  chunkSources?: InsertableKnowledgeChunkSource[];
  links?: InsertableKnowledgeLink[];
  linkSources?: InsertableKnowledgeLinkSource[];
  graphEdges?: InsertableKnowledgeGraphEdge[];
  graphEdgeSources?: InsertableKnowledgeGraphEdgeSource[];
};
export type KnowledgeGraphCandidates = {
  pages: KnowledgePage[];
  pageSources: KnowledgePageSource[];
  links: KnowledgeLink[];
  linkSources: KnowledgeLinkSource[];
  graphEdges: KnowledgeGraphEdge[];
  graphEdgeSources: KnowledgeGraphEdgeSource[];
};

@Injectable()
export class KnowledgeCapsuleRepo {
  constructor(@InjectKysely() private readonly db: KyselyDB) {}

  async upsertCompiledArtifact(
    input: UpsertCompiledArtifactInput,
    trx?: KyselyTransaction,
  ): Promise<KnowledgePage> {
    const [page] = await this.upsertCompiledArtifacts([input], trx);

    return page;
  }

  async upsertCompiledArtifacts(
    inputs: UpsertCompiledArtifactInput[],
    trx?: KyselyTransaction,
  ): Promise<KnowledgePage[]> {
    if (inputs.length === 0) return [];

    const db = dbOrTx(this.db, trx);

    for (const input of inputs) {
      await this.deleteChildArtifacts(input.page.id, trx);
    }

    const pages: KnowledgePage[] = [];
    for (const input of inputs) {
      pages.push(await this.upsertCompiledPage(input, trx));
    }

    await this.insertArtifactChildren(
      db,
      inputs.flatMap((input) => input.pageSources ?? []),
      'knowledgePageSources',
    );
    await this.insertArtifactChildren(
      db,
      inputs.flatMap((input) => input.claims ?? []),
      'knowledgeClaims',
    );
    await this.insertArtifactChildren(
      db,
      inputs.flatMap((input) => input.claimSources ?? []),
      'knowledgeClaimSources',
    );
    await this.insertArtifactChildren(
      db,
      inputs.flatMap((input) => input.chunks ?? []),
      'knowledgeChunks',
    );
    await this.insertArtifactChildren(
      db,
      inputs.flatMap((input) => input.chunkSources ?? []),
      'knowledgeChunkSources',
    );
    await this.insertArtifactChildren(
      db,
      inputs.flatMap((input) => input.links ?? []),
      'knowledgeLinks',
    );
    await this.insertArtifactChildren(
      db,
      inputs.flatMap((input) => input.linkSources ?? []),
      'knowledgeLinkSources',
    );
    await this.insertArtifactChildren(
      db,
      inputs.flatMap((input) => input.graphEdges ?? []),
      'knowledgeGraphEdges',
    );
    await this.insertArtifactChildren(
      db,
      inputs.flatMap((input) => input.graphEdgeSources ?? []),
      'knowledgeGraphEdgeSources',
    );

    return pages;
  }

  private async upsertCompiledPage(
    input: UpsertCompiledArtifactInput,
    trx?: KyselyTransaction,
  ): Promise<KnowledgePage> {
    return await dbOrTx(this.db, trx)
      .insertInto('knowledgePages')
      .values({
        ...input.page,
        staleAt: null,
        updatedAt: new Date(),
      })
      .onConflict((oc) =>
        oc.column('id').doUpdateSet({
          title: input.page.title,
          slug: input.page.slug,
          pageType: input.page.pageType ?? null,
          body: input.page.body,
          summary: input.page.summary ?? null,
          compiledAt: input.page.compiledAt,
          compilerVersion: input.page.compilerVersion,
          compilerRunId: input.page.compilerRunId ?? null,
          compileTaskId: input.page.compileTaskId ?? null,
          staleAt: null,
          updatedAt: new Date(),
        }),
      )
      .returningAll()
      .executeTakeFirstOrThrow();
  }

  private async insertArtifactChildren<T extends Record<string, unknown>>(
    db: KyselyDB | KyselyTransaction,
    rows: T[],
    table:
      | 'knowledgePageSources'
      | 'knowledgeClaims'
      | 'knowledgeClaimSources'
      | 'knowledgeChunks'
      | 'knowledgeChunkSources'
      | 'knowledgeLinks'
      | 'knowledgeLinkSources'
      | 'knowledgeGraphEdges'
      | 'knowledgeGraphEdgeSources',
  ): Promise<void> {
    if (rows.length === 0) return;

    await db.insertInto(table).values(rows as never).execute();
  }

  async markCompileScopeStale(
    input: { workspaceId: string; spaceId: string },
    trx?: KyselyTransaction,
  ): Promise<void> {
    const db = dbOrTx(this.db, trx);
    const tables = [
      'knowledgeClaims',
      'knowledgeChunks',
      'knowledgeLinks',
      'knowledgeGraphEdges',
    ] as const;

    await db
      .updateTable('knowledgePages')
      .set({ staleAt: new Date() })
      .where('workspaceId', '=', input.workspaceId)
      .where('spaceId', '=', input.spaceId)
      .where('compileScope', '=', 'space')
      .execute();

    await Promise.all(
      tables.map((table) =>
        db
          .updateTable(table)
          .set({ staleAt: new Date() })
          .where('workspaceId', '=', input.workspaceId)
          .where('spaceId', '=', input.spaceId)
          .execute(),
      ),
    );
  }

  async findPageCandidates(
    input: {
      workspaceId: string;
      spaceIds: string[];
      query: string;
      limit: number;
    },
    trx?: KyselyTransaction,
  ): Promise<KnowledgePage[]> {
    if (input.spaceIds.length === 0) return [];

    const normalizedQuery = `%${input.query.trim()}%`;

    return dbOrTx(this.db, trx)
      .selectFrom('knowledgePages')
      .selectAll()
      .where('workspaceId', '=', input.workspaceId)
      .where('spaceId', 'in', input.spaceIds)
      .where('staleAt', 'is', null)
      .where((eb) =>
        eb(sql`title`, 'ilike', normalizedQuery).or(
          sql`body`,
          'ilike',
          normalizedQuery,
        ),
      )
      .limit(input.limit)
      .execute();
  }

  async findEmbeddedChunkCandidates(
    input: {
      workspaceId: string;
      spaceIds: string[];
      limit: number;
    },
    trx?: KyselyTransaction,
  ): Promise<KnowledgeChunk[]> {
    if (input.spaceIds.length === 0) return [];

    return dbOrTx(this.db, trx)
      .selectFrom('knowledgeChunks')
      .selectAll()
      .where('workspaceId', '=', input.workspaceId)
      .where('spaceId', 'in', input.spaceIds)
      .where('staleAt', 'is', null)
      .where('embedding', 'is not', null)
      .limit(input.limit)
      .execute();
  }

  async findPagesByIds(
    input: { workspaceId: string; knowledgePageIds: string[] },
    trx?: KyselyTransaction,
  ): Promise<KnowledgePage[]> {
    if (input.knowledgePageIds.length === 0) return [];

    const rows = await dbOrTx(this.db, trx)
      .selectFrom('knowledgePages')
      .selectAll()
      .where('workspaceId', '=', input.workspaceId)
      .where('id', 'in', input.knowledgePageIds)
      .where('staleAt', 'is', null)
      .execute();
    const rowById = new Map(rows.map((row) => [row.id, row]));

    return input.knowledgePageIds
      .map((id) => rowById.get(id))
      .filter((row): row is KnowledgePage => Boolean(row));
  }

  async findGraphCandidatesForSpace(
    input: { workspaceId: string; spaceId: string; limit: number },
    trx?: KyselyTransaction,
  ): Promise<KnowledgeGraphCandidates> {
    const db = dbOrTx(this.db, trx);
    const pages = await db
      .selectFrom('knowledgePages')
      .selectAll()
      .where('workspaceId', '=', input.workspaceId)
      .where('spaceId', '=', input.spaceId)
      .where('staleAt', 'is', null)
      .orderBy('updatedAt', 'desc')
      .limit(input.limit)
      .execute();

    const pageIds = pages.map((page) => page.id);
    if (pageIds.length === 0) {
      return {
        pages,
        pageSources: [],
        links: [],
        linkSources: [],
        graphEdges: [],
        graphEdgeSources: [],
      };
    }

    const [pageSources, links, graphEdges] = await Promise.all([
      db
        .selectFrom('knowledgePageSources')
        .selectAll()
        .where('workspaceId', '=', input.workspaceId)
        .where('knowledgePageId', 'in', pageIds)
        .execute(),
      db
        .selectFrom('knowledgeLinks')
        .selectAll()
        .where('workspaceId', '=', input.workspaceId)
        .where('spaceId', '=', input.spaceId)
        .where('fromKnowledgePageId', 'in', pageIds)
        .where('toKnowledgePageId', 'is not', null)
        .where('isDangling', '=', false)
        .where('staleAt', 'is', null)
        .execute(),
      db
        .selectFrom('knowledgeGraphEdges')
        .selectAll()
        .where('workspaceId', '=', input.workspaceId)
        .where('spaceId', '=', input.spaceId)
        .where('fromKnowledgePageId', 'in', pageIds)
        .where('staleAt', 'is', null)
        .execute(),
    ]);

    const linkIds = links.map((link) => link.id);
    const graphEdgeIds = graphEdges.map((edge) => edge.id);
    const [linkSources, graphEdgeSources] = await Promise.all([
      linkIds.length === 0
        ? []
        : db
            .selectFrom('knowledgeLinkSources')
            .selectAll()
            .where('workspaceId', '=', input.workspaceId)
            .where('linkId', 'in', linkIds)
            .execute(),
      graphEdgeIds.length === 0
        ? []
        : db
            .selectFrom('knowledgeGraphEdgeSources')
            .selectAll()
            .where('workspaceId', '=', input.workspaceId)
            .where('graphEdgeId', 'in', graphEdgeIds)
            .execute(),
    ]);

    return {
      pages,
      pageSources,
      links,
      linkSources,
      graphEdges,
      graphEdgeSources,
    };
  }

  async findDependencySourcePageIds(
    input: { workspaceId: string; knowledgePageIds: string[] },
    trx?: KyselyTransaction,
  ): Promise<string[]> {
    if (input.knowledgePageIds.length === 0) return [];

    const db = dbOrTx(this.db, trx);
    const rows = await Promise.all([
      db
        .selectFrom('knowledgePageSources')
        .select('knowledgePageSources.sourcePageId')
        .where('knowledgePageSources.workspaceId', '=', input.workspaceId)
        .where(
          'knowledgePageSources.knowledgePageId',
          'in',
          input.knowledgePageIds,
        )
        .execute(),
      db
        .selectFrom('knowledgeClaimSources')
        .innerJoin(
          'knowledgeClaims',
          'knowledgeClaimSources.claimId',
          'knowledgeClaims.id',
        )
        .select('knowledgeClaimSources.sourcePageId')
        .where('knowledgeClaims.workspaceId', '=', input.workspaceId)
        .where('knowledgeClaims.knowledgePageId', 'in', input.knowledgePageIds)
        .execute(),
      db
        .selectFrom('knowledgeChunkSources')
        .innerJoin(
          'knowledgeChunks',
          'knowledgeChunkSources.chunkId',
          'knowledgeChunks.id',
        )
        .select('knowledgeChunkSources.sourcePageId')
        .where('knowledgeChunks.workspaceId', '=', input.workspaceId)
        .where('knowledgeChunks.knowledgePageId', 'in', input.knowledgePageIds)
        .execute(),
      db
        .selectFrom('knowledgeLinkSources')
        .innerJoin(
          'knowledgeLinks',
          'knowledgeLinkSources.linkId',
          'knowledgeLinks.id',
        )
        .select('knowledgeLinkSources.sourcePageId')
        .where('knowledgeLinks.workspaceId', '=', input.workspaceId)
        .where('knowledgeLinks.fromKnowledgePageId', 'in', input.knowledgePageIds)
        .execute(),
      db
        .selectFrom('knowledgeGraphEdgeSources')
        .innerJoin(
          'knowledgeGraphEdges',
          'knowledgeGraphEdgeSources.graphEdgeId',
          'knowledgeGraphEdges.id',
        )
        .select('knowledgeGraphEdgeSources.sourcePageId')
        .where('knowledgeGraphEdges.workspaceId', '=', input.workspaceId)
        .where(
          'knowledgeGraphEdges.fromKnowledgePageId',
          'in',
          input.knowledgePageIds,
        )
        .execute(),
    ]);

    return unique(rows.flat().map((row) => (row as SourcePageRow).sourcePageId));
  }

  async findChunkSourcePageIds(
    input: { workspaceId: string; chunkId: string },
    trx?: KyselyTransaction,
  ): Promise<string[]> {
    const rows = await dbOrTx(this.db, trx)
      .selectFrom('knowledgeChunkSources')
      .select('knowledgeChunkSources.sourcePageId')
      .where('knowledgeChunkSources.workspaceId', '=', input.workspaceId)
      .where('knowledgeChunkSources.chunkId', '=', input.chunkId)
      .execute();

    return unique(rows.map((row) => row.sourcePageId));
  }

  async markCapsulesStaleBySourcePageIds(
    input: { workspaceId: string; sourcePageIds: string[] },
    trx?: KyselyTransaction,
  ): Promise<void> {
    if (input.sourcePageIds.length === 0) return;

    const db = dbOrTx(this.db, trx);
    const [
      pageRows,
      claimRows,
      chunkRows,
      linkRows,
      graphEdgeRows,
    ] = await Promise.all([
      db
        .selectFrom('knowledgePageSources')
        .select('knowledgePageSources.knowledgePageId')
        .where('knowledgePageSources.workspaceId', '=', input.workspaceId)
        .where('knowledgePageSources.sourcePageId', 'in', input.sourcePageIds)
        .execute(),
      db
        .selectFrom('knowledgeClaimSources')
        .select('knowledgeClaimSources.claimId')
        .where('knowledgeClaimSources.workspaceId', '=', input.workspaceId)
        .where('knowledgeClaimSources.sourcePageId', 'in', input.sourcePageIds)
        .execute(),
      db
        .selectFrom('knowledgeChunkSources')
        .select('knowledgeChunkSources.chunkId')
        .where('knowledgeChunkSources.workspaceId', '=', input.workspaceId)
        .where('knowledgeChunkSources.sourcePageId', 'in', input.sourcePageIds)
        .execute(),
      db
        .selectFrom('knowledgeLinkSources')
        .select('knowledgeLinkSources.linkId')
        .where('knowledgeLinkSources.workspaceId', '=', input.workspaceId)
        .where('knowledgeLinkSources.sourcePageId', 'in', input.sourcePageIds)
        .execute(),
      db
        .selectFrom('knowledgeGraphEdgeSources')
        .select('knowledgeGraphEdgeSources.graphEdgeId')
        .where('knowledgeGraphEdgeSources.workspaceId', '=', input.workspaceId)
        .where(
          'knowledgeGraphEdgeSources.sourcePageId',
          'in',
          input.sourcePageIds,
        )
        .execute(),
    ]);

    await Promise.all([
      this.markStale(
        'knowledgePages',
        unique(
          pageRows.map(
            (row) =>
              (row as OwnerRow<'knowledgePageId'>).knowledgePageId,
          ),
        ),
        input.workspaceId,
        trx,
      ),
      this.markStale(
        'knowledgeClaims',
        unique(claimRows.map((row) => (row as OwnerRow<'claimId'>).claimId)),
        input.workspaceId,
        trx,
      ),
      this.markStale(
        'knowledgeChunks',
        unique(chunkRows.map((row) => (row as OwnerRow<'chunkId'>).chunkId)),
        input.workspaceId,
        trx,
      ),
      this.markStale(
        'knowledgeLinks',
        unique(linkRows.map((row) => (row as OwnerRow<'linkId'>).linkId)),
        input.workspaceId,
        trx,
      ),
      this.markStale(
        'knowledgeGraphEdges',
        unique(
          graphEdgeRows.map(
            (row) => (row as OwnerRow<'graphEdgeId'>).graphEdgeId,
          ),
        ),
        input.workspaceId,
        trx,
      ),
    ]);
  }

  private async markStale(
    table:
      | 'knowledgePages'
      | 'knowledgeClaims'
      | 'knowledgeChunks'
      | 'knowledgeLinks'
      | 'knowledgeGraphEdges',
    ids: string[],
    workspaceId: string,
    trx?: KyselyTransaction,
  ): Promise<void> {
    if (ids.length === 0) return;

    await dbOrTx(this.db, trx)
      .updateTable(table)
      .set({ staleAt: new Date() })
      .where('workspaceId', '=', workspaceId)
      .where('id', 'in', ids)
      .execute();
  }

  private async deleteChildArtifacts(
    knowledgePageId: string,
    trx?: KyselyTransaction,
  ): Promise<void> {
    const db = dbOrTx(this.db, trx);

    await db
      .deleteFrom('knowledgeGraphEdges')
      .where('fromKnowledgePageId', '=', knowledgePageId)
      .execute();
    await db
      .deleteFrom('knowledgeLinks')
      .where('fromKnowledgePageId', '=', knowledgePageId)
      .execute();
    await db
      .deleteFrom('knowledgeChunks')
      .where('knowledgePageId', '=', knowledgePageId)
      .execute();
    await db
      .deleteFrom('knowledgeClaims')
      .where('knowledgePageId', '=', knowledgePageId)
      .execute();
    await db
      .deleteFrom('knowledgePageSources')
      .where('knowledgePageId', '=', knowledgePageId)
      .execute();
  }
}

function unique(values: string[]): string[] {
  return [...new Set(values)];
}
