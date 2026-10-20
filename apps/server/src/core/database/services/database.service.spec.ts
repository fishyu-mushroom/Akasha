import { BadRequestException } from '@nestjs/common';

// PageService pulls in the collaboration stack (ESM-only deps).
jest.mock('../../page/services/page.service', () => ({
  PageService: class PageService {},
}));

import {
  DatabaseService,
  sanitizeViewConfig,
  validateViewConfig,
} from './database.service';

const properties = [
  { id: 'status', type: 'status', config: {} },
  { id: 'due', type: 'date', config: {} },
  { id: 'n', type: 'number', config: {} },
] as any[];

describe('validateViewConfig', () => {
  it('keeps only known, valid settings', () => {
    expect(
      validateViewConfig(
        'board',
        {
          groupBy: 'status',
          sorts: [{ property: 'n', direction: 'asc', extra: 1 }],
          filter: { and: [{ property: 'n', operator: 'gt', value: 1 }] },
          visibleProperties: ['n', 'n', '__title'],
          propertyWidths: { n: 5000 },
          unexpected: true,
        },
        properties,
      ),
    ).toEqual({
      groupBy: 'status',
      sorts: [{ property: 'n', direction: 'asc' }],
      filter: { and: [{ property: 'n', operator: 'gt', value: 1 }] },
      visibleProperties: ['n', '__title'],
      propertyWidths: { n: 1000 },
    });
  });

  it.each([
    ['board', {}],
    ['board', { groupBy: 'n' }],
    ['calendar', { dateProperty: 'status' }],
    ['table', { visibleProperties: ['missing'] }],
    ['table', { filter: { and: [{ property: 'n', operator: 'contains', value: 1 }] } }],
  ])('rejects invalid %s config %j', (type, config) => {
    expect(() => validateViewConfig(type, config, properties)).toThrow(
      BadRequestException,
    );
  });
});

describe('sanitizeViewConfig', () => {
  it('drops references to deleted properties', () => {
    expect(
      sanitizeViewConfig(
        {
          groupBy: 'gone',
          dateProperty: 'due',
          sorts: [
            { property: 'gone', direction: 'asc' },
            { property: '__title', direction: 'desc' },
          ],
          filter: { or: [{ property: 'gone', operator: 'is_empty' }] },
          visibleProperties: ['gone', 'due'],
          propertyWidths: { gone: 100, due: 120 },
        },
        [{ id: 'due' }],
      ),
    ).toEqual({
      dateProperty: 'due',
      sorts: [{ property: '__title', direction: 'desc' }],
      visibleProperties: ['due'],
      propertyWidths: { due: 120 },
    });
  });
});

describe('DatabaseService', () => {
  const databasePage = {
    id: 'db1',
    type: 'database',
    spaceId: 's1',
    workspaceId: 'w1',
    deletedAt: null,
  };

  function setup(overrides: Record<string, any> = {}) {
    const databaseRepo = {
      findProperties: jest.fn().mockResolvedValue(properties),
      findViews: jest.fn().mockResolvedValue([{ id: 'v1' }]),
      countRows: jest.fn().mockResolvedValue(0),
      findViewById: jest.fn(),
      queryRows: jest.fn().mockResolvedValue({
        items: [{ id: 'r1' }, { id: 'r2' }],
        total: 2,
      }),
      deleteView: jest.fn(),
      ...overrides.databaseRepo,
    };
    const pageRepo = {
      findById: jest.fn().mockResolvedValue(databasePage),
      ...overrides.pageRepo,
    };
    const pagePermissionRepo = {
      filterAccessiblePageIds: jest.fn().mockResolvedValue(['r2']),
    };
    const service = new DatabaseService(
      {} as any,
      databaseRepo as any,
      pageRepo as any,
      pagePermissionRepo as any,
      {} as any,
    );
    return { service, databaseRepo, pageRepo, pagePermissionRepo };
  }

  it('rejects pages that are not databases', async () => {
    const { service } = setup({
      pageRepo: {
        findById: jest.fn().mockResolvedValue({ ...databasePage, type: 'page' }),
      },
    });
    await expect(service.getDatabasePage('db1')).rejects.toThrow(
      'Database not found',
    );
  });

  it('hides rows the caller cannot access', async () => {
    const { service, pagePermissionRepo } = setup();
    const result = await service.queryRows(
      databasePage as any,
      { databaseId: 'db1' },
      { id: 'u1' } as any,
    );
    expect(result.items).toEqual([{ id: 'r2' }]);
    expect(pagePermissionRepo.filterAccessiblePageIds).toHaveBeenCalledWith({
      pageIds: ['r1', 'r2'],
      userId: 'u1',
      spaceId: 's1',
    });
  });

  it('rejects a view from another database', async () => {
    const { service } = setup({
      databaseRepo: {
        findViewById: jest
          .fn()
          .mockResolvedValue({ id: 'v9', databaseId: 'other', config: {} }),
      },
    });
    await expect(
      service.queryRows(
        databasePage as any,
        { databaseId: 'db1', viewId: 'v9' },
        { id: 'u1' } as any,
      ),
    ).rejects.toThrow('View not found');
  });

  it('requires a full date range', async () => {
    const { service } = setup();
    await expect(
      service.queryRows(
        databasePage as any,
        { databaseId: 'db1', rangeStart: '2026-10-01', dateProperty: 'due' },
        { id: 'u1' } as any,
      ),
    ).rejects.toThrow(BadRequestException);
  });

  it('enforces the row limit', async () => {
    const { service } = setup({
      databaseRepo: { countRows: jest.fn().mockResolvedValue(5000) },
    });
    await expect(
      service.createRow(
        databasePage as any,
        { databaseId: 'db1' },
        { id: 'u1' } as any,
      ),
    ).rejects.toThrow('Database row limit reached');
  });

  it('keeps at least one view', async () => {
    const { service, databaseRepo } = setup();
    await expect(
      service.deleteView({ id: 'v1', databaseId: 'db1' } as any),
    ).rejects.toThrow(BadRequestException);
    expect(databaseRepo.deleteView).not.toHaveBeenCalled();
  });
});
