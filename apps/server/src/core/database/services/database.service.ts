import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectKysely } from 'nestjs-kysely';
import { generateJitteredKeyBetween } from 'fractional-indexing-jittered';
import { RawBuilder, SqlBool } from 'kysely';
import { KyselyDB } from '@akasha/db/types/kysely.types';
import {
  DatabaseProperty,
  DatabaseView,
  Page,
  User,
} from '@akasha/db/types/entity.types';
import { PageRepo } from '@akasha/db/repos/page/page.repo';
import { PagePermissionRepo } from '@akasha/db/repos/page/page-permission.repo';
import {
  DatabaseRepo,
  DatabaseRow,
  jsonb,
} from '@akasha/db/repos/database/database.repo';
import { PageService } from '../../page/services/page.service';
import {
  DATABASE_LIMITS,
  DatabaseViewConfig,
  DEFAULT_STATUS_OPTIONS,
  PAGE_TYPE,
  SYSTEM_PROPERTY_IDS,
  ViewFilter,
  ViewSort,
} from '../database.constants';
import {
  getOptions,
  normalizePropertyConfig,
  normalizePropertyPatch,
} from '../database-values';
import { DatabaseQueryBuilder } from '../database-query.builder';
import {
  CreateDatabaseDto,
  CreatePropertyDto,
  CreateRowDto,
  CreateViewDto,
  MoveRowDto,
  QueryRowsDto,
  UpdatePropertyDto,
  UpdateViewDto,
} from '../dto/database.dto';

@Injectable()
export class DatabaseService {
  constructor(
    @InjectKysely() private readonly db: KyselyDB,
    private readonly databaseRepo: DatabaseRepo,
    private readonly pageRepo: PageRepo,
    private readonly pagePermissionRepo: PagePermissionRepo,
    private readonly pageService: PageService,
  ) {}

  /** Loads a live database page or throws NotFound. */
  async getDatabasePage(databaseId: string): Promise<Page> {
    const page = await this.pageRepo.findById(databaseId);
    if (!page || page.deletedAt || page.type !== PAGE_TYPE.DATABASE) {
      throw new NotFoundException('Database not found');
    }
    return page;
  }

  /** Loads a live row page and its database page. */
  async getRowPage(pageId: string): Promise<{ row: Page; database: Page }> {
    const row = await this.pageRepo.findById(pageId);
    if (!row || row.deletedAt || !row.databaseId) {
      throw new NotFoundException('Row not found');
    }
    const database = await this.getDatabasePage(row.databaseId);
    return { row, database };
  }

  async createDatabase(
    user: User,
    workspaceId: string,
    dto: CreateDatabaseDto,
  ): Promise<Page> {
    const names = dto.defaultNames;
    return this.db.transaction().execute(async (trx) => {
      const page = await this.pageService.create(
        user.id,
        workspaceId,
        {
          spaceId: dto.spaceId,
          parentPageId: dto.parentPageId,
          title: dto.title,
          icon: dto.icon,
        },
        { type: PAGE_TYPE.DATABASE, trx },
      );

      const status = await this.databaseRepo.insertProperty(
        {
          workspaceId,
          databaseId: page.id,
          name: names?.status?.trim() || 'Status',
          type: 'status',
          config: jsonb({
            options: DEFAULT_STATUS_OPTIONS.map((option) => ({
              ...option,
              name:
                {
                  todo: names?.todo,
                  in_progress: names?.inProgress,
                  done: names?.done,
                }[option.id]?.trim() || option.name,
            })),
          }),
          position: generateJitteredKeyBetween(null, null),
        },
        trx,
      );

      await this.databaseRepo.insertView(
        {
          workspaceId,
          databaseId: page.id,
          name: names?.view?.trim() || 'Table',
          type: 'table',
          config: jsonb({
            visibleProperties: [status.id],
          } satisfies DatabaseViewConfig),
          position: generateJitteredKeyBetween(null, null),
        },
        trx,
      );

      return page;
    });
  }

  async getInfo(database: Page) {
    const [properties, views, rowCount] = await Promise.all([
      this.databaseRepo.findProperties(database.id),
      this.databaseRepo.findViews(database.id),
      this.databaseRepo.countRows(database.id),
    ]);
    return { database, properties, views, rowCount };
  }

  // Properties

  async createProperty(
    database: Page,
    dto: CreatePropertyDto,
  ): Promise<DatabaseProperty> {
    const properties = await this.databaseRepo.findProperties(database.id);
    if (properties.length >= DATABASE_LIMITS.MAX_PROPERTIES) {
      throw new BadRequestException('Too many properties');
    }
    const last = properties[properties.length - 1];
    return this.databaseRepo.insertProperty({
      workspaceId: database.workspaceId,
      databaseId: database.id,
      name: dto.name.trim() || 'Untitled',
      type: dto.type,
      config: jsonb(normalizePropertyConfig(dto.type, dto.config)),
      position: generateJitteredKeyBetween(last?.position ?? null, null),
    });
  }

  async getProperty(propertyId: string): Promise<DatabaseProperty> {
    const property = await this.databaseRepo.findPropertyById(propertyId);
    if (!property) throw new NotFoundException('Property not found');
    return property;
  }

  async updateProperty(
    property: DatabaseProperty,
    dto: UpdatePropertyDto,
  ): Promise<DatabaseProperty> {
    return this.db.transaction().execute(async (trx) => {
      const patch: Record<string, unknown> = {};
      if (dto.name !== undefined) patch.name = dto.name.trim() || 'Untitled';
      if (dto.position !== undefined) patch.position = dto.position;

      if (dto.config !== undefined) {
        const next = normalizePropertyConfig(property.type, dto.config);
        patch.config = jsonb(next);

        const nextIds = new Set((next.options ?? []).map((o) => o.id));
        const removed = getOptions(property.config)
          .map((o) => o.id)
          .filter((id) => !nextIds.has(id));
        await this.databaseRepo.removeOptionsFromRows({
          databaseId: property.databaseId,
          propertyId: property.id,
          optionIds: removed,
          multi: property.type === 'multi_select',
          trx,
        });
      }

      return this.databaseRepo.updateProperty(property.id, patch, trx);
    });
  }

  async deleteProperty(property: DatabaseProperty): Promise<void> {
    await this.db.transaction().execute(async (trx) => {
      await this.databaseRepo.deleteProperty(property.id, trx);
      await this.databaseRepo.removePropertyFromRows(
        property.databaseId,
        property.id,
        trx,
      );

      // Drop the property from every view config that references it.
      const remaining = await this.databaseRepo.findProperties(
        property.databaseId,
        trx,
      );
      const views = await this.databaseRepo.findViews(property.databaseId, trx);
      for (const view of views) {
        const config = view.config as DatabaseViewConfig;
        const cleaned = sanitizeViewConfig(config, remaining);
        if (JSON.stringify(cleaned) !== JSON.stringify(config)) {
          await this.databaseRepo.updateView(
            view.id,
            { config: jsonb(cleaned) },
            trx,
          );
        }
      }
    });
  }

  // Views

  async createView(database: Page, dto: CreateViewDto): Promise<DatabaseView> {
    const [properties, views] = await Promise.all([
      this.databaseRepo.findProperties(database.id),
      this.databaseRepo.findViews(database.id),
    ]);
    if (views.length >= DATABASE_LIMITS.MAX_VIEWS) {
      throw new BadRequestException('Too many views');
    }

    const config: DatabaseViewConfig = { ...(dto.config ?? {}) };
    if (dto.type === 'board' && !config.groupBy) {
      config.groupBy = properties.find(
        (p) => p.type === 'status' || p.type === 'select',
      )?.id;
    }
    if (dto.type === 'calendar' && !config.dateProperty) {
      config.dateProperty = properties.find((p) => p.type === 'date')?.id;
    }

    const validated = validateViewConfig(dto.type, config, properties);
    const last = views[views.length - 1];
    return this.databaseRepo.insertView({
      workspaceId: database.workspaceId,
      databaseId: database.id,
      name: dto.name.trim() || 'Untitled',
      type: dto.type,
      config: jsonb(validated),
      position: generateJitteredKeyBetween(last?.position ?? null, null),
    });
  }

  async getView(viewId: string): Promise<DatabaseView> {
    const view = await this.databaseRepo.findViewById(viewId);
    if (!view) throw new NotFoundException('View not found');
    return view;
  }

  async updateView(
    view: DatabaseView,
    dto: UpdateViewDto,
  ): Promise<DatabaseView> {
    const patch: Record<string, unknown> = {};
    if (dto.name !== undefined) patch.name = dto.name.trim() || 'Untitled';
    if (dto.position !== undefined) patch.position = dto.position;
    if (dto.config !== undefined) {
      const properties = await this.databaseRepo.findProperties(
        view.databaseId,
      );
      patch.config = jsonb(
        validateViewConfig(view.type, dto.config, properties),
      );
    }
    return this.databaseRepo.updateView(view.id, patch);
  }

  async deleteView(view: DatabaseView): Promise<void> {
    const views = await this.databaseRepo.findViews(view.databaseId);
    if (views.length <= 1) {
      throw new BadRequestException('A database must keep at least one view');
    }
    await this.databaseRepo.deleteView(view.id);
  }

  // Rows

  async queryRows(
    database: Page,
    dto: QueryRowsDto,
    user: User,
  ): Promise<{ items: DatabaseRow[]; total: number }> {
    const properties = await this.databaseRepo.findProperties(database.id);
    let viewConfig: DatabaseViewConfig = {};
    if (dto.viewId) {
      const view = await this.getView(dto.viewId);
      if (view.databaseId !== database.id) {
        throw new NotFoundException('View not found');
      }
      viewConfig = view.config as DatabaseViewConfig;
    }

    const builder = new DatabaseQueryBuilder(properties);
    const where: RawBuilder<SqlBool>[] = [];
    const filter = builder.buildWhere(
      (dto.filter as ViewFilter) ?? viewConfig.filter,
    );
    if (filter) where.push(filter);

    if (dto.rangeStart || dto.rangeEnd) {
      const dateProperty = dto.dateProperty ?? viewConfig.dateProperty;
      if (!dto.rangeStart || !dto.rangeEnd || !dateProperty) {
        throw new BadRequestException(
          'rangeStart, rangeEnd and a date property are required together',
        );
      }
      where.push(
        builder.buildDateRange(dateProperty, dto.rangeStart, dto.rangeEnd),
      );
    }

    const orderBy = builder.buildOrderBy(
      (dto.sorts as unknown as ViewSort[]) ?? viewConfig.sorts,
    );

    const result = await this.databaseRepo.queryRows({
      databaseId: database.id,
      where,
      orderBy,
      offset: dto.offset ?? 0,
      limit: dto.limit ?? 100,
    });

    // Rows inherit the database's permissions, but a row can carry its own
    // restriction. Hide rows the caller cannot see.
    const visibleIds = new Set(
      await this.pagePermissionRepo.filterAccessiblePageIds({
        pageIds: result.items.map((row) => row.id),
        userId: user.id,
        spaceId: database.spaceId,
      }),
    );
    return {
      items: result.items.filter((row) => visibleIds.has(row.id)),
      total: result.total,
    };
  }

  async createRow(
    database: Page,
    dto: CreateRowDto,
    user: User,
  ): Promise<DatabaseRow> {
    const [properties, rowCount] = await Promise.all([
      this.databaseRepo.findProperties(database.id),
      this.databaseRepo.countRows(database.id),
    ]);
    if (rowCount >= DATABASE_LIMITS.MAX_ROWS) {
      throw new BadRequestException('Database row limit reached');
    }
    const { set } = normalizePropertyPatch(properties, dto.properties ?? {});

    const page = await this.pageService.create(
      user.id,
      database.workspaceId,
      {
        spaceId: database.spaceId,
        parentPageId: database.id,
        title: dto.title,
      },
      { properties: set },
    );
    return this.databaseRepo.findRowById(page.id);
  }

  async updateRowProperties(
    row: Page,
    patch: Record<string, unknown>,
    user: User,
  ): Promise<DatabaseRow> {
    const properties = await this.databaseRepo.findProperties(row.databaseId);
    const { set, removed } = normalizePropertyPatch(properties, patch);
    return this.databaseRepo.updateRowProperties({
      pageId: row.id,
      set,
      removed,
      userId: user.id,
    });
  }

  async moveRow(row: Page, dto: MoveRowDto, user: User): Promise<DatabaseRow> {
    const neighbour = async (pageId?: string) => {
      if (!pageId) return null;
      const page = await this.databaseRepo.findRowById(pageId);
      if (!page || page.databaseId !== row.databaseId) {
        throw new BadRequestException('Neighbour row not found');
      }
      return page.position;
    };
    const after = await neighbour(dto.afterPageId);
    const before = await neighbour(dto.beforePageId);
    if (after && before && after >= before) {
      throw new BadRequestException('Invalid neighbour order');
    }

    const properties = await this.databaseRepo.findProperties(row.databaseId);
    const { set, removed } = normalizePropertyPatch(
      properties,
      dto.properties ?? {},
    );
    return this.databaseRepo.updateRowProperties({
      pageId: row.id,
      set,
      removed,
      userId: user.id,
      position: generateJitteredKeyBetween(after, before),
    });
  }
}

/** Removes references to properties that no longer exist. */
export function sanitizeViewConfig(
  config: DatabaseViewConfig,
  properties: Pick<DatabaseProperty, 'id'>[],
): DatabaseViewConfig {
  const known = new Set([
    ...properties.map((p) => p.id),
    ...SYSTEM_PROPERTY_IDS,
  ]);
  const result: DatabaseViewConfig = { ...config };
  if (result.groupBy && !known.has(result.groupBy)) delete result.groupBy;
  if (result.dateProperty && !known.has(result.dateProperty))
    delete result.dateProperty;
  if (result.sorts) {
    result.sorts = result.sorts.filter((s) => known.has(s.property));
  }
  if (result.visibleProperties) {
    result.visibleProperties = result.visibleProperties.filter((id) =>
      known.has(id),
    );
  }
  if (result.propertyWidths) {
    result.propertyWidths = Object.fromEntries(
      Object.entries(result.propertyWidths).filter(([id]) => known.has(id)),
    );
  }
  if (result.filter) {
    const key = result.filter.or ? 'or' : 'and';
    const conditions = (result.filter[key] ?? []).filter((c) =>
      known.has(c.property),
    );
    result.filter = conditions.length ? { [key]: conditions } : undefined;
    if (!result.filter) delete result.filter;
  }
  return result;
}

/** Validates a view config against the schema; throws on invalid input. */
export function validateViewConfig(
  viewType: string,
  input: unknown,
  properties: DatabaseProperty[],
): DatabaseViewConfig {
  const config = (input ?? {}) as DatabaseViewConfig;
  const builder = new DatabaseQueryBuilder(properties);
  const byId = new Map(properties.map((p) => [p.id, p]));
  const result: DatabaseViewConfig = {};

  if (config.filter) {
    builder.buildWhere(config.filter);
    result.filter = config.filter.or
      ? { or: config.filter.or }
      : { and: config.filter.and ?? [] };
  }
  if (config.sorts) {
    builder.buildOrderBy(config.sorts);
    result.sorts = config.sorts.map((s) => ({
      property: s.property,
      direction: s.direction,
    }));
  }

  if (config.groupBy !== undefined) {
    const type = byId.get(config.groupBy)?.type;
    if (type !== 'select' && type !== 'status') {
      throw new BadRequestException('groupBy must be a select or status');
    }
    result.groupBy = config.groupBy;
  }
  if (config.dateProperty !== undefined) {
    if (byId.get(config.dateProperty)?.type !== 'date') {
      throw new BadRequestException('dateProperty must be a date property');
    }
    result.dateProperty = config.dateProperty;
  }
  if (viewType === 'board' && !result.groupBy) {
    throw new BadRequestException('Board view requires a select or status');
  }
  if (viewType === 'calendar' && !result.dateProperty) {
    throw new BadRequestException('Calendar view requires a date property');
  }

  const known = new Set([...byId.keys(), ...SYSTEM_PROPERTY_IDS]);
  if (config.visibleProperties !== undefined) {
    if (
      !Array.isArray(config.visibleProperties) ||
      config.visibleProperties.some((id) => !known.has(id))
    ) {
      throw new BadRequestException('Invalid visibleProperties');
    }
    result.visibleProperties = [...new Set(config.visibleProperties)];
  }
  if (config.propertyWidths !== undefined) {
    const widths: Record<string, number> = {};
    for (const [id, width] of Object.entries(config.propertyWidths ?? {})) {
      if (!known.has(id) || typeof width !== 'number') {
        throw new BadRequestException('Invalid propertyWidths');
      }
      widths[id] = Math.min(Math.max(Math.round(width), 60), 1000);
    }
    result.propertyWidths = widths;
  }
  return result;
}
