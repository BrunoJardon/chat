import { IsString, MaxLength, MinLength } from 'class-validator';

export class CreateMessageRequestDto {
  @IsString()
  @MinLength(1)
  @MaxLength(4000)
  readonly content: string;
}
