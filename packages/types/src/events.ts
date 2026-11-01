import type { MessageDto, MessageErrorCode } from './messages.js';
import type { RoomErrorCode } from './rooms.js';

export const EVENT_NAMES = {
  client: {
    joinRoom: 'room:join',
    leaveRoom: 'room:leave',
    sendMessage: 'message:send',
    typingSet: 'typing:set',
  },

  server: {
    newMessage: 'message:new',
    typingUpdate: 'typing:update',
    presenceUpdate: 'presence:update',
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

export type PresenceStatus = 'online' | 'offline';
export interface ServerPresenceEvent {
  readonly userId: string;
  readonly status: PresenceStatus;
  readonly lastSeen: string | null;
}

export interface ClientSendMessageEvent {
  readonly roomId: string;
  readonly content: string;
}

export interface ServerNewMessageEvent {
  readonly message: MessageDto;
}

export interface ClientIsTypingEvent {
  readonly roomId: string;
  readonly isTyping: boolean;
}

export interface ServerParticipantIsTypingEvent {
  readonly roomId: string;
  readonly userId: string;
  readonly isTyping: boolean;
}

export type EventErrorCode = MessageErrorCode | RoomErrorCode | 'UNAUTHORIZED' | 'INTERNAL_ERROR';

export interface ServerErrorCodeEvent {
  readonly code: EventErrorCode;
}
