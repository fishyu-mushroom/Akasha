import { QueueJob } from '../../integrations/queue/constants';
import { PageListener } from './page.listener';

describe('PageListener knowledge jobs', () => {
  it('enqueues delayed knowledge compile jobs for page spaces on page creation', async () => {
    const { listener, aiQueue, pageRepo } = createListener();
    pageRepo.findSpaceIdsForPages.mockResolvedValue(['space-1']);

    await listener.handlePageCreated({
      workspaceId: 'workspace-1',
      pageIds: ['page-1'],
    });

    expect(pageRepo.findSpaceIdsForPages).toHaveBeenCalledWith({
      workspaceId: 'workspace-1',
      pageIds: ['page-1'],
    });
    expect(aiQueue.add).toHaveBeenCalledWith(
      QueueJob.KNOWLEDGE_COMPILE_SPACE,
      { workspaceId: 'workspace-1', spaceId: 'space-1' },
      {
        delay: 5000,
        jobId: 'knowledge-compile-space:workspace-1:space-1',
      },
    );
  });

  it('enqueues knowledge stale and access reindex jobs on page update', async () => {
    const { listener, aiQueue, pageRepo } = createListener();
    pageRepo.findSpaceIdsForPages.mockResolvedValue(['space-1']);

    await listener.handlePageUpdated({
      workspaceId: 'workspace-1',
      pageIds: ['page-1'],
    });

    expect(aiQueue.add).toHaveBeenCalledWith(
      QueueJob.KNOWLEDGE_MARK_SOURCES_STALE,
      { workspaceId: 'workspace-1', sourcePageIds: ['page-1'] },
    );
    expect(aiQueue.add).toHaveBeenCalledWith(
      QueueJob.KNOWLEDGE_REINDEX_ACCESS,
      { workspaceId: 'workspace-1', sourcePageIds: ['page-1'] },
    );
    expect(aiQueue.add).toHaveBeenCalledWith(
      QueueJob.KNOWLEDGE_COMPILE_SPACE,
      { workspaceId: 'workspace-1', spaceId: 'space-1' },
      {
        delay: 5000,
        jobId: 'knowledge-compile-space:workspace-1:space-1',
      },
    );
  });

  it('enqueues knowledge stale jobs before deleted page events', async () => {
    const { listener, aiQueue, pageRepo } = createListener();

    await listener.handlePageDeleted({
      workspaceId: 'workspace-1',
      pageIds: ['page-1'],
    });

    expect(aiQueue.add.mock.calls.slice(0, 2)).toEqual([
      [
        QueueJob.KNOWLEDGE_MARK_SOURCES_STALE,
        { workspaceId: 'workspace-1', sourcePageIds: ['page-1'] },
      ],
      [QueueJob.PAGE_DELETED, { pageIds: ['page-1'], workspaceId: 'workspace-1' }],
    ]);
    expect(pageRepo.findSpaceIdsForPages).not.toHaveBeenCalled();
  });

  it('enqueues access reindex jobs when pages are created or restored', async () => {
    const { listener, aiQueue, pageRepo } = createListener();
    pageRepo.findSpaceIdsForPages
      .mockResolvedValueOnce(['space-1'])
      .mockResolvedValueOnce(['space-2']);

    await listener.handlePageCreated({
      workspaceId: 'workspace-1',
      pageIds: ['page-1'],
    });
    await listener.handlePageRestored({
      workspaceId: 'workspace-1',
      pageIds: ['page-2'],
    });

    expect(aiQueue.add).toHaveBeenCalledWith(
      QueueJob.KNOWLEDGE_REINDEX_ACCESS,
      { workspaceId: 'workspace-1', sourcePageIds: ['page-1'] },
    );
    expect(aiQueue.add).toHaveBeenCalledWith(
      QueueJob.KNOWLEDGE_REINDEX_ACCESS,
      { workspaceId: 'workspace-1', sourcePageIds: ['page-2'] },
    );
    expect(aiQueue.add).toHaveBeenCalledWith(
      QueueJob.KNOWLEDGE_COMPILE_SPACE,
      { workspaceId: 'workspace-1', spaceId: 'space-2' },
      {
        delay: 5000,
        jobId: 'knowledge-compile-space:workspace-1:space-2',
      },
    );
  });
});

function createListener() {
  const environmentService = {
    getSearchDriver: jest.fn().mockReturnValue('database'),
  };
  const searchQueue = {
    add: jest.fn().mockResolvedValue(undefined),
  };
  const aiQueue = {
    add: jest.fn().mockResolvedValue(undefined),
  };
  const pageRepo = {
    findSpaceIdsForPages: jest.fn().mockResolvedValue([]),
  };

  return {
    listener: new PageListener(
      environmentService as never,
      pageRepo as never,
      searchQueue as never,
      aiQueue as never,
    ),
    searchQueue,
    aiQueue,
    pageRepo,
  };
}
