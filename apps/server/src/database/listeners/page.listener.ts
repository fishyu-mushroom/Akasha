import { Injectable, Logger } from '@nestjs/common';
import { OnEvent } from '@nestjs/event-emitter';
import { EventName } from '../../common/events/event.contants';
import { InjectQueue } from '@nestjs/bullmq';
import { QueueJob, QueueName } from '../../integrations/queue/constants';
import { Queue } from 'bullmq';
import { EnvironmentService } from '../../integrations/environment/environment.service';
import { PageRepo } from '../repos/page/page.repo';

export class PageEvent {
  pageIds: string[];
  workspaceId: string;
}

@Injectable()
export class PageListener {
  private readonly logger = new Logger(PageListener.name);

  constructor(
    private readonly environmentService: EnvironmentService,
    private readonly pageRepo: PageRepo,
    @InjectQueue(QueueName.SEARCH_QUEUE) private searchQueue: Queue,
    @InjectQueue(QueueName.AI_QUEUE) private aiQueue: Queue,
  ) {}

  @OnEvent(EventName.PAGE_CREATED)
  async handlePageCreated(event: PageEvent) {
    const { pageIds, workspaceId } = event;
    if (this.isTypesense()) {
      await this.searchQueue.add(QueueJob.PAGE_CREATED, {
        pageIds,
      });
    }

    await this.aiQueue.add(QueueJob.PAGE_CREATED, { pageIds, workspaceId });
    await this.enqueueKnowledgeAccessReindex(workspaceId, pageIds);
    await this.enqueueKnowledgeCompileForPages(workspaceId, pageIds);
  }

  @OnEvent(EventName.PAGE_UPDATED)
  async handlePageUpdated(event: PageEvent) {
    const { pageIds, workspaceId } = event;

    await this.searchQueue.add(QueueJob.PAGE_UPDATED, { pageIds });
    await this.enqueueKnowledgeSourceInvalidation(workspaceId, pageIds);
    await this.enqueueKnowledgeAccessReindex(workspaceId, pageIds);
    await this.enqueueKnowledgeCompileForPages(workspaceId, pageIds);
  }

  @OnEvent(EventName.PAGE_DELETED)
  async handlePageDeleted(event: PageEvent) {
    const { pageIds, workspaceId } = event;
    if (this.isTypesense()) {
      await this.searchQueue.add(QueueJob.PAGE_DELETED, { pageIds });
    }

    await this.enqueueKnowledgeSourceInvalidation(workspaceId, pageIds);
    await this.aiQueue.add(QueueJob.PAGE_DELETED, { pageIds, workspaceId });
  }

  @OnEvent(EventName.PAGE_SOFT_DELETED)
  async handlePageSoftDeleted(event: PageEvent) {
    const { pageIds, workspaceId } = event;

    if (this.isTypesense()) {
      await this.searchQueue.add(QueueJob.PAGE_SOFT_DELETED, { pageIds });
    }

    await this.enqueueKnowledgeSourceInvalidation(workspaceId, pageIds);
    await this.aiQueue.add(QueueJob.PAGE_SOFT_DELETED, {
      pageIds,
      workspaceId,
    });
  }

  @OnEvent(EventName.PAGE_RESTORED)
  async handlePageRestored(event: PageEvent) {
    const { pageIds, workspaceId } = event;
    if (this.isTypesense()) {
      await this.searchQueue.add(QueueJob.PAGE_RESTORED, { pageIds });
    }

    await this.aiQueue.add(QueueJob.PAGE_RESTORED, { pageIds, workspaceId });
    await this.enqueueKnowledgeSourceInvalidation(workspaceId, pageIds);
    await this.enqueueKnowledgeAccessReindex(workspaceId, pageIds);
    await this.enqueueKnowledgeCompileForPages(workspaceId, pageIds);
  }

  isTypesense(): boolean {
    return this.environmentService.getSearchDriver() === 'typesense';
  }

  private async enqueueKnowledgeSourceInvalidation(
    workspaceId: string,
    pageIds: string[],
  ): Promise<void> {
    if (!workspaceId || pageIds.length === 0) return;

    await this.aiQueue.add(QueueJob.KNOWLEDGE_MARK_SOURCES_STALE, {
      workspaceId,
      sourcePageIds: pageIds,
    });
  }

  private async enqueueKnowledgeAccessReindex(
    workspaceId: string,
    pageIds: string[],
  ): Promise<void> {
    if (!workspaceId || pageIds.length === 0) return;

    await this.aiQueue.add(QueueJob.KNOWLEDGE_REINDEX_ACCESS, {
      workspaceId,
      sourcePageIds: pageIds,
    });
  }

  private async enqueueKnowledgeCompileForPages(
    workspaceId: string,
    pageIds: string[],
  ): Promise<void> {
    if (!workspaceId || pageIds.length === 0) return;

    const spaceIds = await this.pageRepo.findSpaceIdsForPages({
      workspaceId,
      pageIds,
    });

    for (const spaceId of spaceIds) {
      await this.aiQueue.add(
        QueueJob.KNOWLEDGE_COMPILE_SPACE,
        {
          workspaceId,
          spaceId,
        },
        {
          delay: 5000,
          jobId: `knowledge-compile-space:${workspaceId}:${spaceId}`,
        },
      );
    }
  }
}
