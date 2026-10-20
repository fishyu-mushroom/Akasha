import {
  Body,
  Controller,
  ForbiddenException,
  HttpCode,
  HttpStatus,
  NotFoundException,
  Post,
  UseGuards,
} from '@nestjs/common';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { AuthUser } from '../../common/decorators/auth-user.decorator';
import { AuthWorkspace } from '../../common/decorators/auth-workspace.decorator';
import { Page, User, Workspace } from '@akasha/db/types/entity.types';
import { PageRepo } from '@akasha/db/repos/page/page.repo';
import { PageAccessService } from '../page/page-access/page-access.service';
import SpaceAbilityFactory from '../casl/abilities/space-ability.factory';
import {
  SpaceCaslAction,
  SpaceCaslSubject,
} from '../casl/interfaces/space-ability.type';
import { DatabaseService } from './services/database.service';
import {
  CreateDatabaseDto,
  CreatePropertyDto,
  CreateRowDto,
  CreateViewDto,
  DatabaseIdDto,
  MoveRowDto,
  PropertyIdDto,
  QueryRowsDto,
  UpdatePropertyDto,
  UpdateRowPropertiesDto,
  UpdateViewDto,
  ViewIdDto,
} from './dto/database.dto';

@UseGuards(JwtAuthGuard)
@Controller('databases')
export class DatabaseController {
  constructor(
    private readonly databaseService: DatabaseService,
    private readonly pageRepo: PageRepo,
    private readonly pageAccessService: PageAccessService,
    private readonly spaceAbility: SpaceAbilityFactory,
  ) {}

  @HttpCode(HttpStatus.OK)
  @Post('create')
  async create(
    @Body() dto: CreateDatabaseDto,
    @AuthUser() user: User,
    @AuthWorkspace() workspace: Workspace,
  ) {
    if (dto.parentPageId) {
      const parent = await this.pageRepo.findById(dto.parentPageId);
      if (!parent || parent.deletedAt || parent.spaceId !== dto.spaceId) {
        throw new NotFoundException('Parent page not found');
      }
      await this.pageAccessService.validateCanEdit(parent, user);
    } else {
      const ability = await this.spaceAbility.createForUser(user, dto.spaceId);
      if (ability.cannot(SpaceCaslAction.Create, SpaceCaslSubject.Page)) {
        throw new ForbiddenException();
      }
    }
    const page = await this.databaseService.createDatabase(
      user,
      workspace.id,
      dto,
    );
    return this.databaseService.getInfo(page);
  }

  @HttpCode(HttpStatus.OK)
  @Post('info')
  async info(@Body() dto: DatabaseIdDto, @AuthUser() user: User) {
    const database = await this.databaseService.getDatabasePage(dto.databaseId);
    const { canEdit, hasRestriction } =
      await this.pageAccessService.validateCanViewWithPermissions(
        database,
        user,
      );
    const info = await this.databaseService.getInfo(database);
    return { ...info, permissions: { canEdit, hasRestriction } };
  }

  // Properties

  @HttpCode(HttpStatus.OK)
  @Post('properties/create')
  async createProperty(@Body() dto: CreatePropertyDto, @AuthUser() user: User) {
    const database = await this.editableDatabase(dto.databaseId, user);
    return this.databaseService.createProperty(database, dto);
  }

  @HttpCode(HttpStatus.OK)
  @Post('properties/update')
  async updateProperty(@Body() dto: UpdatePropertyDto, @AuthUser() user: User) {
    const property = await this.databaseService.getProperty(dto.propertyId);
    await this.editableDatabase(property.databaseId, user);
    return this.databaseService.updateProperty(property, dto);
  }

  @HttpCode(HttpStatus.OK)
  @Post('properties/delete')
  async deleteProperty(@Body() dto: PropertyIdDto, @AuthUser() user: User) {
    const property = await this.databaseService.getProperty(dto.propertyId);
    await this.editableDatabase(property.databaseId, user);
    await this.databaseService.deleteProperty(property);
  }

  // Views

  @HttpCode(HttpStatus.OK)
  @Post('views/create')
  async createView(@Body() dto: CreateViewDto, @AuthUser() user: User) {
    const database = await this.editableDatabase(dto.databaseId, user);
    return this.databaseService.createView(database, dto);
  }

  @HttpCode(HttpStatus.OK)
  @Post('views/update')
  async updateView(@Body() dto: UpdateViewDto, @AuthUser() user: User) {
    const view = await this.databaseService.getView(dto.viewId);
    await this.editableDatabase(view.databaseId, user);
    return this.databaseService.updateView(view, dto);
  }

  @HttpCode(HttpStatus.OK)
  @Post('views/delete')
  async deleteView(@Body() dto: ViewIdDto, @AuthUser() user: User) {
    const view = await this.databaseService.getView(dto.viewId);
    await this.editableDatabase(view.databaseId, user);
    await this.databaseService.deleteView(view);
  }

  // Rows

  @HttpCode(HttpStatus.OK)
  @Post('rows/query')
  async queryRows(@Body() dto: QueryRowsDto, @AuthUser() user: User) {
    const database = await this.databaseService.getDatabasePage(dto.databaseId);
    await this.pageAccessService.validateCanView(database, user);
    return this.databaseService.queryRows(database, dto, user);
  }

  @HttpCode(HttpStatus.OK)
  @Post('rows/create')
  async createRow(@Body() dto: CreateRowDto, @AuthUser() user: User) {
    const database = await this.editableDatabase(dto.databaseId, user);
    return this.databaseService.createRow(database, dto, user);
  }

  @HttpCode(HttpStatus.OK)
  @Post('rows/update-properties')
  async updateRowProperties(
    @Body() dto: UpdateRowPropertiesDto,
    @AuthUser() user: User,
  ) {
    const { row } = await this.databaseService.getRowPage(dto.pageId);
    await this.pageAccessService.validateCanEdit(row, user);
    return this.databaseService.updateRowProperties(row, dto.properties, user);
  }

  @HttpCode(HttpStatus.OK)
  @Post('rows/move')
  async moveRow(@Body() dto: MoveRowDto, @AuthUser() user: User) {
    const { row } = await this.databaseService.getRowPage(dto.pageId);
    await this.pageAccessService.validateCanEdit(row, user);
    return this.databaseService.moveRow(row, dto, user);
  }

  private async editableDatabase(databaseId: string, user: User): Promise<Page> {
    const database = await this.databaseService.getDatabasePage(databaseId);
    await this.pageAccessService.validateCanEdit(database, user);
    return database;
  }
}
