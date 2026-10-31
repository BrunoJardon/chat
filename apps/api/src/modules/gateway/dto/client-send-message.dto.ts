import type { ClientSendMessageEvent } from '@chat/types';
import { IsString, IsUUID, MaxLength, MinLength } from 'class-validator';

export class ClientSendMessageEventDto implements ClientSendMessageEvent {
  @IsUUID()
  readonly roomId: string;

  @IsString()
  @MinLength(1)
  @MaxLength(4000)
  readonly content: string;
}
