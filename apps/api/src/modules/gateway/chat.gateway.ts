import { BadRequestException, Logger } from '@nestjs/common';
import {
  ConnectedSocket,
  MessageBody,
  SubscribeMessage,
  WebSocketGateway,
  WebSocketServer,
} from '@nestjs/websockets';
import type { Server, Socket } from 'socket.io';
import {
  EVENT_NAMES,
  ServerParticipantIsTypingEvent,
  type ServerErrorCodeEvent,
  type ServerNewMessageEvent,
} from '@chat/types';
import { Public } from '../auth/decorators/public.decorator.js';
import { JwtService } from '../auth/jwt/jwt.service.js';
import { MessagesService } from '../messages/messages.service.js';
import { RoomsService } from '../rooms/rooms.service.js';
import { ClientSendMessageEventDto } from './dto/client-send-message.dto.js';
import { ClientJoinRoomEventDto, ClientLeaveRoomEventDto } from './dto/join-leave-room.dto.js';
import { ClientIsTypingDto } from './dto/client-is-typing.dto.js';

@Public()
@WebSocketGateway({
  cors: { origin: '*' },
  pingInterval: 60000,
  pingTimeout: 45000,
})
export class ChatGateway {
  private readonly logger = new Logger(ChatGateway.name);

  @WebSocketServer()
  private readonly io!: Server;

  constructor(
    private readonly jwt: JwtService,
    private readonly messages: MessagesService,
    private readonly rooms: RoomsService,
  ) {}

  async handleConnection(socket: Socket): Promise<void> {
    // using the auth token in the headers for Postman compatibility (temporary as frontend client)
    const userAccessToken: unknown =
      socket.handshake.auth?.token || socket.handshake.headers?.token;

    if (typeof userAccessToken !== 'string' || userAccessToken.length === 0) {
      console.log('[invalid type]');
      socket.emit(EVENT_NAMES.server.error, {
        code: 'UNAUTHORIZED',
      });
      socket.disconnect(true);
      return;
    }

    let userId: string;
    try {
      const { payload } = await this.jwt.verifyAccess(userAccessToken);
      userId = payload.sub;
      socket.data.userId = userId;
    } catch {
      console.log('[invalid token]');
      socket.emit(EVENT_NAMES.server.error, {
        code: 'UNAUTHORIZED',
      } satisfies ServerErrorCodeEvent);
      socket.disconnect(true);
      return;
    }
  }

  @SubscribeMessage(EVENT_NAMES.client.joinRoom)
  async handleJoinRoom(
    @ConnectedSocket() socket: Socket,
    @MessageBody() body: ClientJoinRoomEventDto,
  ): Promise<void> {
    const userId: string = socket.data.userId;

    const isMember = await this.rooms.isMember(body.roomId, userId);
    if (!isMember) {
      console.log(socket.data.userId);
      socket.emit(EVENT_NAMES.server.error, {
        code: 'NOT_ROOM_MEMBER',
      } satisfies ServerErrorCodeEvent);
      return;
    }

    await socket.join(body.roomId);
  }

  @SubscribeMessage(EVENT_NAMES.client.leaveRoom)
  async handleLeaveRoom(
    @ConnectedSocket() socket: Socket,
    @MessageBody() body: ClientLeaveRoomEventDto,
  ): Promise<void> {
    await socket.leave(body.roomId);
  }

  @SubscribeMessage(EVENT_NAMES.client.typingSet)
  async handleClientIsTyping(
    @ConnectedSocket() socket: Socket,
    @MessageBody() body: ClientIsTypingDto,
  ): Promise<void> {
    console.log(socket.rooms.has(body.roomId));
    if (!socket.rooms.has(body.roomId)) {
      socket.emit(EVENT_NAMES.server.error, {
        code: 'NOT_ROOM_MEMBER',
      } satisfies ServerErrorCodeEvent);
      return;
    }

    socket.to(body.roomId).emit(EVENT_NAMES.server.typingUpdate, {
      roomId: body.roomId,
      userId: socket.data.userId,
      isTyping: body.isTyping,
    } satisfies ServerParticipantIsTypingEvent);
  }

  @SubscribeMessage(EVENT_NAMES.client.sendMessage)
  async handleClientSendMessage(
    @ConnectedSocket() socket: Socket,
    @MessageBody() body: ClientSendMessageEventDto,
  ): Promise<void> {
    const userId: string = socket.data.userId;

    const isMember = await this.rooms.isMember(body.roomId, userId);
    if (!isMember) {
      socket.emit(EVENT_NAMES.server.error, {
        code: 'NOT_ROOM_MEMBER',
      } satisfies ServerErrorCodeEvent);

      return;
    }

    try {
      const message = await this.messages.createMessage(body.roomId, userId, body);

      this.io
        .to(body.roomId)
        .emit(EVENT_NAMES.server.newMessage, { message } satisfies ServerNewMessageEvent);
    } catch (err) {
      if (err instanceof BadRequestException) {
        socket.emit(EVENT_NAMES.server.error, {
          code: 'EMPTY_MESSAGE',
        } satisfies ServerErrorCodeEvent);
      } else {
        this.logger.error(`[message:send] failed for room ${body.roomId}: ${String(err)}`);
        socket.emit(EVENT_NAMES.server.error, {
          code: 'INTERNAL_ERROR',
        } satisfies ServerErrorCodeEvent);
      }
    }
  }
}
