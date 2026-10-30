import { ClientJoinRoomEvent } from '@chat/types';
import { IsUUID } from 'class-validator';

export class ClientJoinRoomEventDto implements ClientJoinRoomEvent {
  @IsUUID()
  readonly roomId: string;
}

export class ClientLeaveRoomEventDto extends ClientJoinRoomEventDto {}
