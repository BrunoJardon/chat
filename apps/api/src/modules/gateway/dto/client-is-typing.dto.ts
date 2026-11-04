import { ClientIsTypingEvent } from '@chat/types';
import { IsBoolean, IsUUID } from 'class-validator';

export class ClientIsTypingDto implements ClientIsTypingEvent {
  @IsUUID()
  readonly roomId: string;

  @IsBoolean()
  readonly isTyping: boolean;
}
