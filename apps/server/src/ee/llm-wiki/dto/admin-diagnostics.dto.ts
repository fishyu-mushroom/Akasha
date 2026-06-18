import { Type } from 'class-transformer';
import { IsArray, IsInt, IsOptional, IsString, Max, Min } from 'class-validator';

export class AdminKnowledgeDiagnosticsDto {
  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  spaceIds?: string[];

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  limit?: number;
}
