import {
  IsArray,
  IsIn,
  IsInt,
  IsObject,
  IsOptional,
  IsString,
  IsUUID,
  Matches,
  Max,
  MaxLength,
  Min,
  ValidateNested,
} from 'class-validator';
import { Type } from 'class-transformer';
import {
  DATABASE_LIMITS,
  PROPERTY_TYPES,
  VIEW_TYPES,
} from '../database.constants';

const DATE_ONLY = /^\d{4}-\d{2}-\d{2}$/;

export class DatabaseDefaultNamesDto {
  @IsOptional()
  @IsString()
  @MaxLength(200)
  view?: string;

  @IsOptional()
  @IsString()
  @MaxLength(200)
  status?: string;

  @IsOptional()
  @IsString()
  @MaxLength(200)
  todo?: string;

  @IsOptional()
  @IsString()
  @MaxLength(200)
  inProgress?: string;

  @IsOptional()
  @IsString()
  @MaxLength(200)
  done?: string;
}

export class CreateDatabaseDto {
  @IsUUID()
  spaceId: string;

  // Localized names for the default view/property, chosen by the client.
  @IsOptional()
  @ValidateNested()
  @Type(() => DatabaseDefaultNamesDto)
  defaultNames?: DatabaseDefaultNamesDto;

  @IsOptional()
  @IsString()
  parentPageId?: string;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  title?: string;

  @IsOptional()
  @IsString()
  icon?: string;
}

export class DatabaseIdDto {
  @IsUUID()
  databaseId: string;
}

export class CreatePropertyDto extends DatabaseIdDto {
  @IsString()
  @MaxLength(200)
  name: string;

  @IsIn(PROPERTY_TYPES)
  type: string;

  @IsOptional()
  @IsObject()
  config?: Record<string, unknown>;
}

export class UpdatePropertyDto {
  @IsUUID()
  propertyId: string;

  @IsOptional()
  @IsString()
  @MaxLength(200)
  name?: string;

  @IsOptional()
  @IsObject()
  config?: Record<string, unknown>;

  @IsOptional()
  @IsString()
  position?: string;
}

export class PropertyIdDto {
  @IsUUID()
  propertyId: string;
}

export class CreateViewDto extends DatabaseIdDto {
  @IsString()
  @MaxLength(200)
  name: string;

  @IsIn(VIEW_TYPES)
  type: string;

  @IsOptional()
  @IsObject()
  config?: Record<string, unknown>;
}

export class UpdateViewDto {
  @IsUUID()
  viewId: string;

  @IsOptional()
  @IsString()
  @MaxLength(200)
  name?: string;

  @IsOptional()
  @IsObject()
  config?: Record<string, unknown>;

  @IsOptional()
  @IsString()
  position?: string;
}

export class ViewIdDto {
  @IsUUID()
  viewId: string;
}

export class QueryRowsDto extends DatabaseIdDto {
  @IsOptional()
  @IsUUID()
  viewId?: string;

  // Overrides the view's saved filter/sorts when provided.
  @IsOptional()
  @IsObject()
  filter?: Record<string, unknown>;

  @IsOptional()
  @IsArray()
  sorts?: Array<Record<string, unknown>>;

  @IsOptional()
  @IsString()
  dateProperty?: string;

  @IsOptional()
  @Matches(DATE_ONLY)
  rangeStart?: string;

  @IsOptional()
  @Matches(DATE_ONLY)
  rangeEnd?: string;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  offset?: number;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(DATABASE_LIMITS.MAX_QUERY_LIMIT)
  limit?: number;
}

export class CreateRowDto extends DatabaseIdDto {
  @IsOptional()
  @IsString()
  @MaxLength(500)
  title?: string;

  @IsOptional()
  @IsObject()
  properties?: Record<string, unknown>;
}

export class UpdateRowPropertiesDto {
  @IsUUID()
  pageId: string;

  @IsObject()
  properties: Record<string, unknown>;
}

export class MoveRowDto {
  @IsUUID()
  pageId: string;

  // Neighbours in the target ordering; either may be omitted at the edges.
  @IsOptional()
  @IsUUID()
  afterPageId?: string;

  @IsOptional()
  @IsUUID()
  beforePageId?: string;

  @IsOptional()
  @IsObject()
  properties?: Record<string, unknown>;
}
