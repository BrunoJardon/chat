export type RoomType = 'private' | 'group';

export interface RoomParticipant {
  readonly id: string;
  readonly name: string;
}

export interface CreateRoomRequest {
  readonly participantId: string;
}

export interface RoomSummary {
  readonly id: string;
  readonly type: RoomType;
  readonly participants: RoomParticipant[];
}

export type RoomDetail = RoomSummary;

export type RoomErrorCode =
  'NOT_ROOM_MEMBER' | 'ROOM_NOT_FOUND' | 'USER_NOT_FOUND' | 'SELF_PARTICIPANT' | 'INVALID_ROOM_ID';
