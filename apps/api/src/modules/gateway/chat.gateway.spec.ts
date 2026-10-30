import { BadRequestException } from '@nestjs/common';
import { EVENT_NAMES } from '@chat/types';
import type { Server, Socket } from 'socket.io';

vi.mock('@nestjs/websockets', () => ({
  WebSocketGateway: () => (target: any) => target,
  WebSocketServer: () => (target: any, key: string) => {
    // no-op decorator for unit tests
  },
  SubscribeMessage: () => (target: any, key: string, descriptor: PropertyDescriptor) => descriptor,
  ConnectedSocket: () => () => ({}),
  MessageBody: () => () => ({}),
}));

import { ChatGateway } from './chat.gateway.js';
import type { JwtService } from '../auth/jwt/jwt.service.js';
import type { MessagesService } from '../messages/messages.service.js';
import type { RoomsService } from '../rooms/rooms.service.js';

const USER_ID = '11111111-1111-4111-8111-111111111111';
const ROOM_ID = '22222222-2222-4222-8222-222222222222';

function makeJwt() {
  return {
    verifyAccess: vi.fn(),
  } as unknown as JwtService;
}

function makeMessages() {
  return {
    createMessage: vi.fn(),
  } as unknown as MessagesService;
}

function makeRooms() {
  return {
    isMember: vi.fn(),
  } as unknown as RoomsService;
}

function makeSocket(overrides: Partial<Socket> = {}): Socket {
  const socket: any = {
    id: 'socket-1',
    handshake: {
      auth: {},
      headers: {},
    },
    data: {},
    emit: vi.fn((event: string, payload?: unknown, ack?: (...args: unknown[]) => void) => {
      if (typeof ack === 'function') {
        ack();
      }
      return socket;
    }),
    disconnect: vi.fn().mockReturnThis(),
    join: vi.fn().mockResolvedValue(undefined),
    leave: vi.fn().mockResolvedValue(undefined),
    rooms: new Set<string>(),
    to: vi.fn().mockReturnThis(),
    ...overrides,
  };

  return socket as Socket;
}

function makeIo() {
  const emit = vi.fn();
  const to = vi.fn().mockReturnValue({ emit });

  return {
    io: { to } as unknown as Server,
    to,
    emit,
  };
}

describe('ChatGateway', () => {
  let jwt: ReturnType<typeof makeJwt>;
  let messages: ReturnType<typeof makeMessages>;
  let rooms: ReturnType<typeof makeRooms>;
  let gateway: ChatGateway;
  let ioMocks: ReturnType<typeof makeIo>;

  beforeEach(() => {
    jwt = makeJwt();
    messages = makeMessages();
    rooms = makeRooms();
    ioMocks = makeIo();

    gateway = new ChatGateway(jwt, messages, rooms);
    (gateway as any).io = ioMocks.io;
  });

  describe('handleConnection', () => {
    it('emits UNAUTHORIZED and disconnects when no token is present', async () => {
      const socket = makeSocket();

      await gateway.handleConnection(socket);

      expect(socket.emit).toHaveBeenCalledWith(
        EVENT_NAMES.server.error,
        { code: 'UNAUTHORIZED' },
        expect.any(Function),
      );
      expect(socket.disconnect).toHaveBeenCalledWith(true);
      expect(jwt.verifyAccess).not.toHaveBeenCalled();
    });

    it('accepts token from handshake.auth', async () => {
      const socket = makeSocket({
        handshake: { auth: { token: 'access-token' }, headers: {} } as any,
      });
      (jwt.verifyAccess as any).mockResolvedValue({ payload: { sub: USER_ID } });

      await gateway.handleConnection(socket);

      expect(jwt.verifyAccess).toHaveBeenCalledWith('access-token');
      expect(socket.data.userId).toBe(USER_ID);
      expect(socket.emit).not.toHaveBeenCalled();
      expect(socket.disconnect).not.toHaveBeenCalled();
    });

    it('accepts token from handshake.headers as fallback (Postman compatibility)', async () => {
      const socket = makeSocket({
        handshake: { auth: {}, headers: { token: 'header-token' } } as any,
      });
      (jwt.verifyAccess as any).mockResolvedValue({ payload: { sub: USER_ID } });

      await gateway.handleConnection(socket);

      expect(jwt.verifyAccess).toHaveBeenCalledWith('header-token');
      expect(socket.data.userId).toBe(USER_ID);
      expect(socket.emit).not.toHaveBeenCalled();
      expect(socket.disconnect).not.toHaveBeenCalled();
    });

    it('prefers handshake.auth.token over handshake.headers.token', async () => {
      const socket = makeSocket({
        handshake: { auth: { token: 'auth-token' }, headers: { token: 'header-token' } } as any,
      });
      (jwt.verifyAccess as any).mockResolvedValue({ payload: { sub: USER_ID } });

      await gateway.handleConnection(socket);

      expect(jwt.verifyAccess).toHaveBeenCalledWith('auth-token');
    });

    it('emits UNAUTHORIZED and disconnects when token is invalid', async () => {
      const socket = makeSocket({
        handshake: { auth: { token: 'bad-token' }, headers: {} } as any,
      });
      (jwt.verifyAccess as any).mockRejectedValue(new Error('invalid token'));

      await gateway.handleConnection(socket);

      expect(jwt.verifyAccess).toHaveBeenCalledWith('bad-token');
      expect(socket.emit).toHaveBeenCalledWith(
        EVENT_NAMES.server.error,
        { code: 'UNAUTHORIZED' },
        expect.any(Function),
      );
      expect(socket.disconnect).toHaveBeenCalledWith(true);
      expect(socket.data.userId).toBeUndefined();
    });

    it('calls ack before disconnecting on UNAUTHORIZED', async () => {
      const socket = makeSocket();
      const emit = socket.emit as any;

      await gateway.handleConnection(socket);

      const ack = emit.mock.calls[0][2] as () => void;
      expect(typeof ack).toBe('function');

      ack();

      expect(socket.disconnect).toHaveBeenCalledWith(true);
    });
  });

  describe('handleJoinRoom', () => {
    it('emits NOT_ROOM_MEMBER and does not join when user is not a member', async () => {
      const socket = makeSocket();
      socket.data.userId = USER_ID;
      (rooms.isMember as any).mockResolvedValue(false);

      await gateway.handleJoinRoom(socket, { roomId: ROOM_ID });

      expect(rooms.isMember).toHaveBeenCalledWith(ROOM_ID, USER_ID);
      expect(socket.emit).toHaveBeenCalledWith(EVENT_NAMES.server.error, {
        code: 'NOT_ROOM_MEMBER',
      });
      expect(socket.join).not.toHaveBeenCalled();
    });

    it('joins the room when user is a member', async () => {
      const socket = makeSocket();
      socket.data.userId = USER_ID;
      (rooms.isMember as any).mockResolvedValue(true);

      await gateway.handleJoinRoom(socket, { roomId: ROOM_ID });

      expect(rooms.isMember).toHaveBeenCalledWith(ROOM_ID, USER_ID);
      expect(socket.join).toHaveBeenCalledWith(ROOM_ID);
      expect(socket.emit).not.toHaveBeenCalled();
    });
  });

  describe('handleLeaveRoom', () => {
    it('leaves the room', async () => {
      const socket = makeSocket();

      await gateway.handleLeaveRoom(socket, { roomId: ROOM_ID });

      expect(socket.leave).toHaveBeenCalledWith(ROOM_ID);
    });
  });

  describe('handleClientSendMessage', () => {
    const message = {
      id: '33333333-3333-4333-8333-333333333333',
      roomId: ROOM_ID,
      authorId: USER_ID,
      content: 'hello',
      createdAt: '2026-10-29T00:00:00.000Z',
      author: { id: USER_ID, name: 'Test User' },
    };

    it('emits NOT_ROOM_MEMBER and does not create/send when user is not a member', async () => {
      const socket = makeSocket();
      socket.data.userId = USER_ID;
      (rooms.isMember as any).mockResolvedValue(false);

      await gateway.handleClientSendMessage(socket, { roomId: ROOM_ID, content: 'hello' });

      expect(rooms.isMember).toHaveBeenCalledWith(ROOM_ID, USER_ID);
      expect(socket.emit).toHaveBeenCalledWith(EVENT_NAMES.server.error, {
        code: 'NOT_ROOM_MEMBER',
      });
      expect(messages.createMessage).not.toHaveBeenCalled();
      expect(ioMocks.to).not.toHaveBeenCalled();
    });

    it('persists the message and broadcasts message:new to the room', async () => {
      const socket = makeSocket();
      socket.data.userId = USER_ID;
      (rooms.isMember as any).mockResolvedValue(true);
      (messages.createMessage as any).mockResolvedValue(message);

      await gateway.handleClientSendMessage(socket, { roomId: ROOM_ID, content: '  hello  ' });

      expect(rooms.isMember).toHaveBeenCalledWith(ROOM_ID, USER_ID);
      expect(messages.createMessage).toHaveBeenCalledWith(ROOM_ID, USER_ID, {
        roomId: ROOM_ID,
        content: '  hello  ',
      });
      expect(ioMocks.to).toHaveBeenCalledWith(ROOM_ID);
      expect(ioMocks.emit).toHaveBeenCalledWith(EVENT_NAMES.server.newMessage, { message });
      expect(socket.emit).not.toHaveBeenCalled();
    });

    it('emits EMPTY_MESSAGE when createMessage throws BadRequestException', async () => {
      const socket = makeSocket();
      socket.data.userId = USER_ID;
      (rooms.isMember as any).mockResolvedValue(true);
      (messages.createMessage as any).mockRejectedValue(new BadRequestException('EMPTY_MESSAGE'));

      await gateway.handleClientSendMessage(socket, { roomId: ROOM_ID, content: '   ' });

      expect(socket.emit).toHaveBeenCalledWith(EVENT_NAMES.server.error, {
        code: 'EMPTY_MESSAGE',
      });
      expect(ioMocks.to).not.toHaveBeenCalled();
    });

    it('emits INTERNAL_ERROR and logs when createMessage throws an unexpected error', async () => {
      const socket = makeSocket();
      socket.data.userId = USER_ID;
      (rooms.isMember as any).mockResolvedValue(true);
      const error = new Error('db down');
      (messages.createMessage as any).mockRejectedValue(error);
      const errorSpy = vi
        .spyOn((gateway as any).logger, 'error')
        .mockImplementation(() => undefined);

      await gateway.handleClientSendMessage(socket, { roomId: ROOM_ID, content: 'hi' });

      expect(errorSpy).toHaveBeenCalledWith(
        `[message:send] failed for room ${ROOM_ID}: Error: db down`,
      );
      expect(socket.emit).toHaveBeenCalledWith(EVENT_NAMES.server.error, {
        code: 'INTERNAL_ERROR',
      });
      expect(ioMocks.to).not.toHaveBeenCalled();

      errorSpy.mockRestore();
    });
  });
});
