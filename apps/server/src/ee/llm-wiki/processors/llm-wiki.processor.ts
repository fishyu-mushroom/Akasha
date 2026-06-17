import { Inject, Logger, OnModuleDestroy } from '@nestjs/common';
import { InjectQueue, OnWorkerEvent, Processor, WorkerHost } from '@nestjs/bullmq';
import { Job, Queue } from 'bullmq';
import { KnowledgeCapsuleRepo } from '@docmost/db/repos/llm-wiki/knowledge-capsule.repo';
import { KnowledgeSourceRepo } from '@docmost/db/repos/llm-wiki/knowledge-source.repo';
import { PageRepo } from '@docmost/db/repos/page/page.repo';
import { QueueJob, QueueName } from '../../../integrations/queue/constants';
import {
  DEFAULT_KNOWLEDGE_COMPILER_VERSION,
  DEFAULT_KNOWLEDGE_PROMPT_VERSION,
  KNOWLEDGE_COMPILER_ADAPTER,
} from '../llm-wiki.constants';
import { KnowledgeCompilerAdapter } from '../adapters/knowledge-compiler.adapter';
import { KnowledgeImportService } from '../services/knowledge-import.service';
import {
  IKnowledgeCompileSpaceJob,
  IKnowledgeMarkSourcesStaleJob,
  IKnowledgeReindexAccessJob,
} from '../../../integrations/queue/constants/queue.interface';
import { KnowledgeAccessIndexerService } from '../services/knowledge-access-indexer.service';
import { KnowledgeSourceExporterService } from '../services/knowledge-source-exporter.service';

@Processor(QueueName.AI_QUEUE)
export class LlmWikiProcessor extends WorkerHost implements OnModuleDestroy {
  private readonly logger = new Logger(LlmWikiProcessor.name);

  constructor(
    private readonly sourceExporter: KnowledgeSourceExporterService,
    @Inject(KNOWLEDGE_COMPILER_ADAPTER)
    private readonly compiler: KnowledgeCompilerAdapter,
    private readonly importService: KnowledgeImportService,
    private readonly accessIndexer: KnowledgeAccessIndexerService,
    private readonly sourceRepo: KnowledgeSourceRepo,
    private readonly capsuleRepo: KnowledgeCapsuleRepo,
    private readonly pageRepo: PageRepo,
    @InjectQueue(QueueName.AI_QUEUE) private readonly aiQueue: Queue,
  ) {
    super();
  }

  async process(job: Job): Promise<void> {
    switch (job.name) {
      case QueueJob.KNOWLEDGE_COMPILE_SPACE: {
        const data = job.data as IKnowledgeCompileSpaceJob;
        const sources = await this.sourceExporter.exportSpaceSources({
          workspaceId: data.workspaceId,
          spaceId: data.spaceId,
        });
        const compileInput = {
          workspaceId: data.workspaceId,
          spaceId: data.spaceId,
          compilerVersion: DEFAULT_KNOWLEDGE_COMPILER_VERSION,
          promptVersion: DEFAULT_KNOWLEDGE_PROMPT_VERSION,
          sources,
        };
        const compileResult = await this.compiler.compileSpace(compileInput);
        await this.importService.importCompileResult({
          input: compileInput,
          artifacts: compileResult.artifacts,
        });
        await this.accessIndexer.reindexSourcePages({
          workspaceId: data.workspaceId,
          sourcePageIds: sources.map((source) => source.sourcePageId),
        });
        break;
      }
      case QueueJob.KNOWLEDGE_REINDEX_ACCESS: {
        const data = job.data as IKnowledgeReindexAccessJob;
        if (data.sourcePageIds?.length) {
          await this.accessIndexer.reindexSourcePages({
            workspaceId: data.workspaceId,
            sourcePageIds: data.sourcePageIds,
          });
        } else if (data.spaceId) {
          await this.accessIndexer.markScopeStale({
            workspaceId: data.workspaceId,
            spaceId: data.spaceId,
          });
        }
        break;
      }
      case QueueJob.KNOWLEDGE_MARK_SOURCES_STALE: {
        const data = job.data as IKnowledgeMarkSourcesStaleJob;
        await this.sourceRepo.markSourcesStale({
          workspaceId: data.workspaceId,
          sourcePageIds: data.sourcePageIds,
        });
        await this.capsuleRepo.markCapsulesStaleBySourcePageIds({
          workspaceId: data.workspaceId,
          sourcePageIds: data.sourcePageIds,
        });
        break;
      }
      case QueueJob.PAGE_CONTENT_UPDATED: {
        const data = job.data as { workspaceId: string; pageIds: string[] };
        await this.handlePageContentUpdated(data);
        break;
      }
    }
  }

  private async handlePageContentUpdated(data: {
    workspaceId: string;
    pageIds: string[];
  }): Promise<void> {
    if (!data.workspaceId || !data.pageIds?.length) return;

    await this.sourceRepo.markSourcesStale({
      workspaceId: data.workspaceId,
      sourcePageIds: data.pageIds,
    });
    await this.capsuleRepo.markCapsulesStaleBySourcePageIds({
      workspaceId: data.workspaceId,
      sourcePageIds: data.pageIds,
    });
    await this.accessIndexer.reindexSourcePages({
      workspaceId: data.workspaceId,
      sourcePageIds: data.pageIds,
    });

    const spaceIds = await this.pageRepo.findSpaceIdsForPages({
      workspaceId: data.workspaceId,
      pageIds: data.pageIds,
    });

    for (const spaceId of spaceIds) {
      await this.aiQueue.add(
        QueueJob.KNOWLEDGE_COMPILE_SPACE,
        {
          workspaceId: data.workspaceId,
          spaceId,
        },
        {
          delay: 5000,
          jobId: `knowledge-compile-space:${data.workspaceId}:${spaceId}`,
        },
      );
    }
  }

  @OnWorkerEvent('active')
  onActive(job: Job) {
    this.logger.debug(`Processing ${job.name} job`);
  }

  @OnWorkerEvent('failed')
  onError(job: Job) {
    this.logger.error(
      `Error processing ${job.name} job. Reason: ${job.failedReason}`,
    );
  }

  @OnWorkerEvent('completed')
  onCompleted(job: Job) {
    this.logger.debug(`Completed ${job.name} job`);
  }

  async onModuleDestroy(): Promise<void> {
    if (this.worker) {
      await this.worker.close();
    }
  }
}
