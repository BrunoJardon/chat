import { Type } from 'class-transformer';
import { IsInt, IsNumber, IsOptional, IsUUID, Max, Min } from 'class-validator';
import { PAGINATION_TAKEN_LIMIT } from '../messages.constants.js';

export class ListMessagesDto {
  @IsOptional()
  @IsUUID()
  readonly before?: string;

  @IsOptional()
  @IsNumber()
  @IsInt()
  @Min(1)
  @Max(PAGINATION_TAKEN_LIMIT)
  @Type(() => Number)
  readonly limit?: number;
}
