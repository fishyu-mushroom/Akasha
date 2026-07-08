import { PageRepo } from '@akasha/db/repos/page/page.repo';
import { KnowledgeSourceExporterService } from './knowledge-source-exporter.service';

describe('KnowledgeSourceExporterService', () => {
  it('exports page snapshots for one workspace and space', async () => {
    const pageRepo = {
      findPagesForKnowledgeExport: jest.fn().mockResolvedValue([
        {
          id: 'page-1',
          workspaceId: 'workspace-1',
          spaceId: 'space-1',
          title: 'Page 1',
          textContent: 'Page body',
          updatedAt: new Date('2026-06-16T00:00:00.000Z'),
        },
      ]),
    };
    const service = new KnowledgeSourceExporterService(
      pageRepo as unknown as PageRepo,
    );

    const snapshots = await service.exportSpaceSources({
      workspaceId: 'workspace-1',
      spaceId: 'space-1',
    });

    expect(pageRepo.findPagesForKnowledgeExport).toHaveBeenCalledWith({
      workspaceId: 'workspace-1',
      spaceId: 'space-1',
    });
    expect(snapshots).toEqual([
      {
        workspaceId: 'workspace-1',
        spaceId: 'space-1',
        sourcePageId: 'page-1',
        sourceVersion: '2026-06-16T00:00:00.000Z',
        contentHash: expect.stringMatching(/^sha256:/),
        title: 'Page 1',
        text: 'Page body',
        references: [],
      },
    ]);
  });

  it('uses empty text when a page has no text content', async () => {
    const pageRepo = {
      findPagesForKnowledgeExport: jest.fn().mockResolvedValue([
        {
          id: 'page-1',
          workspaceId: 'workspace-1',
          spaceId: 'space-1',
          title: 'Empty',
          textContent: null,
          updatedAt: new Date('2026-06-16T00:00:00.000Z'),
        },
      ]),
    };
    const service = new KnowledgeSourceExporterService(
      pageRepo as unknown as PageRepo,
    );

    await expect(
      service.exportSpaceSources({
        workspaceId: 'workspace-1',
        spaceId: 'space-1',
      }),
    ).resolves.toMatchObject([{ text: '' }]);
  });
});
