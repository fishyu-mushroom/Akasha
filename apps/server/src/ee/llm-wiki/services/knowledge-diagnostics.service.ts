import { Injectable } from '@nestjs/common';
import { InjectQueue } from '@nestjs/bullmq';
import { InjectKysely } from 'nestjs-kysely';
import { Job, JobState, Queue } from 'bullmq';
import { KyselyDB } from '@docmost/db/types/kysely.types';
import { QueueJob, QueueName } from '../../../integrations/queue/constants';

const KNOWLEDGE_JOB_NAMES = new Set<string>([
  QueueJob.PAGE_CONTENT_UPDATED,
  QueueJob.KNOWLEDGE_COMPILE_SPACE,
  QueueJob.KNOWLEDGE_MARK_SOURCES_STALE,
  QueueJob.KNOWLEDGE_REINDEX_ACCESS,
]);

const JOB_STATES: JobState[] = [
  'waiting',
  'delayed',
  'active',
  'failed',
  'completed',
];

type CountRow = {
  sourcePageId: string;
  count: string | number | bigint;
};

export type KnowledgeDiagnosticsPage = {
  pageId: string;
  slugId: string;
  title: string;
  spaceId: string;
  spaceName: string;
  spaceSlug: string;
  updatedAt: Date;
  deletedAt: Date | null;
  textLength: number;
  knowledgeSourceCount: number;
  staleSourceCount: number;
  knowledgePageSourceCount: number;
  knowledgeChunkCount: number;
};

export type KnowledgeDiagnosticsJob = {
  id: string;
  name: string;
  state: string;
  workspaceId?: string;
  spaceId?: string;
  pageIds: string[];
  timestamp?: number;
  processedOn?: number;
  finishedOn?: number;
  failedReason?: string;
};

@Injectable()
export class KnowledgeDiagnosticsService {
  constructor(
    @InjectKysely() private readonly db: KyselyDB,
    @InjectQueue(QueueName.AI_QUEUE) private readonly aiQueue: Queue,
  ) {}

  async getWorkspaceDiagnostics(input: {
    workspaceId: string;
    spaceIds?: string[];
    limit?: number;
  }): Promise<{ pages: KnowledgeDiagnosticsPage[]; jobs: KnowledgeDiagnosticsJob[] }> {
    const limit = Math.min(Math.max(input.limit ?? 50, 1), 100);
    const pages = await this.findRecentPages({
      workspaceId: input.workspaceId,
      spaceIds: input.spaceIds ?? [],
      limit,
    });
    const pageIds = pages.map((page) => page.pageId);
    const [sourceCounts, staleSourceCounts, pageSourceCounts, chunkCounts, jobs] =
      await Promise.all([
        this.countSources(input.workspaceId, pageIds, false),
        this.countSources(input.workspaceId, pageIds, true),
        this.countBySourcePage('knowledgePageSources', input.workspaceId, pageIds),
        this.countBySourcePage('knowledgeChunkSources', input.workspaceId, pageIds),
        this.findKnowledgeJobs(input.workspaceId, limit),
      ]);

    return {
      pages: pages.map((page) => ({
        ...page,
        knowledgeSourceCount: sourceCounts.get(page.pageId) ?? 0,
        staleSourceCount: staleSourceCounts.get(page.pageId) ?? 0,
        knowledgePageSourceCount: pageSourceCounts.get(page.pageId) ?? 0,
        knowledgeChunkCount: chunkCounts.get(page.pageId) ?? 0,
      })),
      jobs,
    };
  }

  private async findRecentPages(input: {
    workspaceId: string;
    spaceIds: string[];
    limit: number;
  }): Promise<Omit<KnowledgeDiagnosticsPage, 'knowledgeSourceCount' | 'staleSourceCount' | 'knowledgePageSourceCount' | 'knowledgeChunkCount'>[]> {
    let query = this.db
      .selectFrom('pages as p')
      .innerJoin('spaces as s', 's.id', 'p.spaceId')
      .select([
        'p.id as pageId',
        'p.slugId',
        'p.title',
        'p.spaceId',
        's.name as spaceName',
        's.slug as spaceSlug',
        'p.updatedAt',
        'p.deletedAt',
      ])
      .select((eb) => eb.fn('length', ['p.textContent']).as('textLength'))
      .where('p.workspaceId', '=', input.workspaceId)
      .orderBy('p.updatedAt', 'desc')
      .limit(input.limit);

    if (input.spaceIds.length > 0) {
      query = query.where('p.spaceId', 'in', input.spaceIds);
    }

    const rows = await query.execute();
    return rows.map((row) => ({
      pageId: row.pageId,
      slugId: row.slugId,
      title: row.title,
      spaceId: row.spaceId,
      spaceName: row.spaceName,
      spaceSlug: row.spaceSlug,
      updatedAt: row.updatedAt,
      deletedAt: row.deletedAt,
      textLength: Number(row.textLength ?? 0),
    }));
  }

  private async countSources(
    workspaceId: string,
    sourcePageIds: string[],
    staleOnly: boolean,
  ): Promise<Map<string, number>> {
    if (sourcePageIds.length === 0) return new Map();

    let query = this.db
      .selectFrom('knowledgeSources')
      .select(['sourcePageId'])
      .select((eb) => eb.fn.count('id').as('count'))
      .where('workspaceId', '=', workspaceId)
      .where('sourcePageId', 'in', sourcePageIds)
      .groupBy('sourcePageId');

    if (staleOnly) {
      query = query.where('staleAt', 'is not', null);
    }

    return rowsToCountMap(await query.execute());
  }

  private async countBySourcePage(
    table: 'knowledgePageSources' | 'knowledgeChunkSources',
    workspaceId: string,
    sourcePageIds: string[],
  ): Promise<Map<string, number>> {
    if (sourcePageIds.length === 0) return new Map();

    const rows = await this.db
      .selectFrom(table)
      .select(['sourcePageId'])
      .select((eb) => eb.fn.countAll().as('count'))
      .where('workspaceId', '=', workspaceId)
      .where('sourcePageId', 'in', sourcePageIds)
      .groupBy('sourcePageId')
      .execute();

    return rowsToCountMap(rows);
  }

  private async findKnowledgeJobs(
    workspaceId: string,
    limit: number,
  ): Promise<KnowledgeDiagnosticsJob[]> {
    const jobs = await this.aiQueue.getJobs(JOB_STATES, 0, limit * 4, false);
    const rows = await Promise.all(
      jobs
        .filter((job) => KNOWLEDGE_JOB_NAMES.has(job.name))
        .filter((job) => job.data?.workspaceId === workspaceId)
        .slice(0, limit)
        .map((job) => this.toDiagnosticsJob(job)),
    );

    return rows;
  }

  private async toDiagnosticsJob(job: Job): Promise<KnowledgeDiagnosticsJob> {
    const state = await job.getState();
    return {
      id: String(job.id),
      name: job.name,
      state,
      workspaceId: job.data?.workspaceId,
      spaceId: job.data?.spaceId,
      pageIds: Array.isArray(job.data?.pageIds)
        ? job.data.pageIds
        : Array.isArray(job.data?.sourcePageIds)
          ? job.data.sourcePageIds
          : [],
      timestamp: job.timestamp,
      processedOn: job.processedOn,
      finishedOn: job.finishedOn,
      failedReason: job.failedReason,
    };
  }
}

function rowsToCountMap(rows: CountRow[]): Map<string, number> {
  return new Map(
    rows.map((row) => [row.sourcePageId, Number(row.count ?? 0)]),
  );
}
