import type { MessageDto, MessageErrorCode } from './messages.js';
import type { RoomErrorCode } from './rooms.js';

export const EVENT_NAMES = {
  client: {
    joinRoom: 'room:join',
    leaveRoom: 'room:leave',
    sendMessage: 'message:send',
  },

  server: {
    newMessage: 'message:new',
    error: 'event:error',
  },
} as const;

export interface ClientHandshake {
  readonly token: string;
}

export interface ClientJoinRoomEvent {
  readonly roomId: string;
}

export type ClientLeaveRoomEvent = ClientJoinRoomEvent;

export interface ClientSendMessageEvent {
  readonly roomId: string;
  readonly content: string;
}

export interface ServerNewMessageEvent {
  readonly message: MessageDto;
}

export type EventErrorCode = MessageErrorCode | RoomErrorCode | 'UNAUTHORIZED' | 'INTERNAL_ERROR';

export interface ServerErrorCodeEvent {
  readonly code: EventErrorCode;
}
