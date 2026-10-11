import type { RoomParticipant } from './rooms.js';

export type MessageAuthor = RoomParticipant;

export interface CreateMessageRequest {
  readonly content: string;
}

export interface MessageDto {
  readonly id: string;
  readonly roomId: string;
  readonly author: MessageAuthor;
  readonly content: string;
  readonly createdAt: string;
}

export interface MessagesPage {
  readonly messages: MessageDto[];
  readonly hasMore: boolean;
  readonly nextCursor: string | null;
}

export type MessageErrorCode = 'EMPTY_MESSAGE';
