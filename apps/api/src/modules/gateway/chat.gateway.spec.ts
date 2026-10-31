import { BadRequestException } from '@nestjs/common';
import { EVENT_NAMES } from '@chat/types';
import { ChatGateway } from './chat.gateway.js';
import type { JwtService } from '../auth/jwt/jwt.service.js';
import type { MessagesService } from '../messages/messages.service.js';
import type { RoomsService } from '../rooms/rooms.service.js';
import type { PresenceService } from './presence.service.js';

const USER_ID = '11111111-1111-4111-8111-111111111111';
const ROOM_ID = '22222222-2222-4222-8222-222222222222';
const ROOM_ID_2 = '44444444-4444-4444-8444-444444444444';

function makeJwt() {
  return {
    verifyAccess: vi.fn(),
  };
}

function makeRooms() {
  return {
    isMember: vi.fn(),
    listRooms: vi.fn(),
  };
}

function makeMessages() {
  return {
    createMessage: vi.fn(),
  };
}

function makePresence() {
  return {
    setOnline: vi.fn(),
    setOffline: vi.fn(),
    getPresence: vi.fn(),
    getSocketIds: vi.fn(),
    refresh: vi.fn().mockResolvedValue(undefined),
  };
}

function makeSocket(overrides: Partial<any> = {}) {
  const roomsSet = new Set<string>();
  const socket: any = {
    id: 'socket-1',
    handshake: { auth: {}, headers: {} },
    data: { userId: USER_ID },
    emit: vi.fn(),
    disconnect: vi.fn(),
    join: vi.fn().mockImplementation((roomId: string) => {
      roomsSet.add(roomId);
      return Promise.resolve();
    }),
    leave: vi.fn().mockImplementation((roomId: string) => {
      roomsSet.delete(roomId);
      return Promise.resolve();
    }),
    rooms: roomsSet,
    to: vi.fn().mockReturnValue({ emit: vi.fn() }),
    ...overrides,
  };

  if (overrides.rooms instanceof Set) {
    socket.rooms = overrides.rooms;
  } else if (Array.isArray(overrides.rooms)) {
    socket.rooms = new Set(overrides.rooms);
  }

  return socket;
}

describe('ChatGateway', () => {
  let gateway: ChatGateway;
  let jwt: ReturnType<typeof makeJwt>;
  let rooms: ReturnType<typeof makeRooms>;
  let messages: ReturnType<typeof makeMessages>;
  let presence: ReturnType<typeof makePresence>;

  beforeEach(() => {
    jwt = makeJwt();
    rooms = makeRooms();
    messages = makeMessages();
    presence = makePresence();

    gateway = new ChatGateway(
      jwt as unknown as JwtService,
      messages as unknown as MessagesService,
      rooms as unknown as RoomsService,
      presence as unknown as PresenceService,
    );
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  describe('handleConnection', () => {
    it('emits UNAUTHORIZED and disconnects when no token is provided', async () => {
      const socket = makeSocket({ data: {}, handshake: { auth: {}, headers: {} } });

      await gateway.handleConnection(socket);

      expect(socket.emit).toHaveBeenCalledWith(
        EVENT_NAMES.server.error,
        expect.objectContaining({ code: 'UNAUTHORIZED' }),
      );
      expect(socket.disconnect).toHaveBeenCalledWith(true);
      expect(jwt.verifyAccess).not.toHaveBeenCalled();
    });

    it('accepts token from handshake.auth', async () => {
      const socket = makeSocket({ handshake: { auth: { token: 'access-token' }, headers: {} } });
      jwt.verifyAccess.mockResolvedValue({ payload: { sub: USER_ID } });
      presence.setOnline.mockResolvedValue(null);

      await gateway.handleConnection(socket);

      expect(jwt.verifyAccess).toHaveBeenCalledWith('access-token');
      expect(socket.data.userId).toBe(USER_ID);
      expect(presence.setOnline).toHaveBeenCalledWith(USER_ID, socket.id);
      expect(socket.emit).not.toHaveBeenCalled();
      expect(socket.disconnect).not.toHaveBeenCalled();
    });

    it('accepts token from handshake.headers for Postman compatibility', async () => {
      const socket = makeSocket({ handshake: { auth: {}, headers: { token: 'header-token' } } });
      jwt.verifyAccess.mockResolvedValue({ payload: { sub: USER_ID } });
      presence.setOnline.mockResolvedValue(null);

      await gateway.handleConnection(socket);

      expect(jwt.verifyAccess).toHaveBeenCalledWith('header-token');
      expect(socket.data.userId).toBe(USER_ID);
      expect(presence.setOnline).toHaveBeenCalledWith(USER_ID, socket.id);
      expect(socket.disconnect).not.toHaveBeenCalled();
    });

    it('emits UNAUTHORIZED and disconnects when token is invalid', async () => {
      const socket = makeSocket({ handshake: { auth: { token: 'bad-token' }, headers: {} } });
      jwt.verifyAccess.mockRejectedValue(new Error('invalid token'));

      await gateway.handleConnection(socket);

      expect(socket.emit).toHaveBeenCalledWith(
        EVENT_NAMES.server.error,
        expect.objectContaining({ code: 'UNAUTHORIZED' }),
      );
      expect(socket.disconnect).toHaveBeenCalledWith(true);
      expect(presence.setOnline).not.toHaveBeenCalled();
    });

    it('broadcasts presence to all user rooms on transition to online', async () => {
      const socket = makeSocket({ handshake: { auth: { token: 'access-token' }, headers: {} } });
      const event = { userId: USER_ID, status: 'online', lastSeen: null };
      const emit = vi.fn();
      const to = vi.fn().mockReturnValue({ emit });
      (gateway as any).io = { to, sockets: { sockets: new Map() } };

      jwt.verifyAccess.mockResolvedValue({ payload: { sub: USER_ID } });
      presence.setOnline.mockResolvedValue(event);
      rooms.listRooms.mockResolvedValue([
        { id: ROOM_ID, type: 'private', participants: [] },
        { id: ROOM_ID_2, type: 'private', participants: [] },
      ] as any);

      await gateway.handleConnection(socket);

      expect(presence.setOnline).toHaveBeenCalledWith(USER_ID, socket.id);
      expect(rooms.listRooms).toHaveBeenCalledWith(USER_ID);
      expect(to).toHaveBeenCalledTimes(2);
      expect(to).toHaveBeenCalledWith(ROOM_ID);
      expect(to).toHaveBeenCalledWith(ROOM_ID_2);
      expect(emit).toHaveBeenCalledTimes(2);
      expect(emit).toHaveBeenCalledWith(EVENT_NAMES.server.presenceUpdate, event);
    });

    it('does not broadcast when setOnline returns null (already online)', async () => {
      const socket = makeSocket({ handshake: { auth: { token: 'access-token' }, headers: {} } });
      const emit = vi.fn();
      const to = vi.fn().mockReturnValue({ emit });
      (gateway as any).io = { to };

      jwt.verifyAccess.mockResolvedValue({ payload: { sub: USER_ID } });
      presence.setOnline.mockResolvedValue(null);

      await gateway.handleConnection(socket);

      expect(presence.setOnline).toHaveBeenCalledWith(USER_ID, socket.id);
      expect(rooms.listRooms).not.toHaveBeenCalled();
      expect(to).not.toHaveBeenCalled();
      expect(emit).not.toHaveBeenCalled();
    });

    it('emits INTERNAL_ERROR and disconnects when presence fails', async () => {
      const socket = makeSocket({ handshake: { auth: { token: 'access-token' }, headers: {} } });
      jwt.verifyAccess.mockResolvedValue({ payload: { sub: USER_ID } });
      presence.setOnline.mockRejectedValue(new Error('redis down'));

      await gateway.handleConnection(socket);

      expect(socket.emit).toHaveBeenCalledWith(
        EVENT_NAMES.server.error,
        expect.objectContaining({ code: 'INTERNAL_ERROR' }),
      );
      expect(socket.disconnect).toHaveBeenCalledWith(true);
    });
  });

  describe('handleDisconnect', () => {
    it('broadcasts presence offline when last socket disconnects', async () => {
      const socket = makeSocket({ data: { userId: USER_ID } });
      const event = { userId: USER_ID, status: 'offline', lastSeen: '2026-10-31T00:00:00.000Z' };
      const emit = vi.fn();
      const to = vi.fn().mockReturnValue({ emit });
      (gateway as any).io = { to };

      presence.setOffline.mockResolvedValue(event);
      rooms.listRooms.mockResolvedValue([
        { id: ROOM_ID, type: 'private', participants: [] },
      ] as any);

      await gateway.handleDisconnect(socket);

      expect(presence.setOffline).toHaveBeenCalledWith(USER_ID, socket.id);
      expect(rooms.listRooms).toHaveBeenCalledWith(USER_ID);
      expect(to).toHaveBeenCalledWith(ROOM_ID);
      expect(emit).toHaveBeenCalledWith(EVENT_NAMES.server.presenceUpdate, event);
    });

    it('does not broadcast when other sockets remain', async () => {
      const socket = makeSocket({ data: { userId: USER_ID } });
      const emit = vi.fn();
      const to = vi.fn().mockReturnValue({ emit });
      (gateway as any).io = { to };

      presence.setOffline.mockResolvedValue(null);

      await gateway.handleDisconnect(socket);

      expect(presence.setOffline).toHaveBeenCalledWith(USER_ID, socket.id);
      expect(rooms.listRooms).not.toHaveBeenCalled();
      expect(to).not.toHaveBeenCalled();
    });

    it('does nothing when socket has no userId', async () => {
      const socket = makeSocket({ data: {} });

      await gateway.handleDisconnect(socket);

      expect(presence.setOffline).not.toHaveBeenCalled();
    });

    it('logs error when setOffline fails', async () => {
      const socket = makeSocket({ data: { userId: USER_ID } });
      const loggerError = vi.spyOn((gateway as any).logger, 'error').mockImplementation(() => {});
      presence.setOffline.mockRejectedValue(new Error('redis down'));

      await gateway.handleDisconnect(socket);

      expect(loggerError).toHaveBeenCalled();
      loggerError.mockRestore();
    });
  });

  describe('onApplicationBootstrap', () => {
    it('starts a timer that refreshes connected sockets', async () => {
      vi.useFakeTimers();
      const sockets = new Map([
        ['s1', {}],
        ['s2', {}],
      ]);
      (gateway as any).io = { sockets: { sockets } };

      try {
        gateway.onApplicationBootstrap();

        expect((gateway as any).refreshTimer).toBeDefined();
        await vi.advanceTimersByTimeAsync(30000);

        expect(presence.refresh).toHaveBeenCalledWith(['s1', 's2']);
      } finally {
        gateway.onApplicationShutdown();
        vi.useRealTimers();
      }
    });

    it('logs error when refresh fails', async () => {
      vi.useFakeTimers();
      const sockets = new Map([['s1', {}]]);
      (gateway as any).io = { sockets: { sockets } };
      const loggerError = vi.spyOn((gateway as any).logger, 'error').mockImplementation(() => {});
      presence.refresh.mockRejectedValue(new Error('boom'));

      try {
        gateway.onApplicationBootstrap();
        await vi.advanceTimersByTimeAsync(30000);
        await Promise.resolve();

        expect(loggerError).toHaveBeenCalled();
      } finally {
        loggerError.mockRestore();
        gateway.onApplicationShutdown();
        vi.useRealTimers();
      }
    });
  });

  describe('onApplicationShutdown', () => {
    it('clears the refresh timer', () => {
      vi.useFakeTimers();
      (gateway as any).io = { sockets: { sockets: new Map() } };

      gateway.onApplicationBootstrap();
      const timer = (gateway as any).refreshTimer;
      expect(timer).toBeDefined();

      gateway.onApplicationShutdown();
      expect((gateway as any).refreshTimer).toBeUndefined();

      vi.useRealTimers();
    });
  });

  describe('handleJoinRoom', () => {
    it('joins the room when the user is a member', async () => {
      const socket = makeSocket({ data: { userId: USER_ID } });
      rooms.isMember.mockResolvedValue(true);

      await gateway.handleJoinRoom(socket, { roomId: ROOM_ID });

      expect(rooms.isMember).toHaveBeenCalledWith(ROOM_ID, USER_ID);
      expect(socket.join).toHaveBeenCalledWith(ROOM_ID);
      expect(socket.emit).not.toHaveBeenCalled();
    });

    it('emits NOT_ROOM_MEMBER and does not join when not a member', async () => {
      const socket = makeSocket({ data: { userId: USER_ID } });
      rooms.isMember.mockResolvedValue(false);

      await gateway.handleJoinRoom(socket, { roomId: ROOM_ID });

      expect(rooms.isMember).toHaveBeenCalledWith(ROOM_ID, USER_ID);
      expect(socket.join).not.toHaveBeenCalled();
      expect(socket.emit).toHaveBeenCalledWith(
        EVENT_NAMES.server.error,
        expect.objectContaining({ code: 'NOT_ROOM_MEMBER' }),
      );
    });
  });

  describe('handleLeaveRoom', () => {
    it('leaves the room', async () => {
      const socket = makeSocket({ data: { userId: USER_ID } });

      await gateway.handleLeaveRoom(socket, { roomId: ROOM_ID });

      expect(socket.leave).toHaveBeenCalledWith(ROOM_ID);
    });
  });

  describe('handleClientIsTyping', () => {
    it('emits typing:update to the other members in the room', async () => {
      const socket = makeSocket({ data: { userId: USER_ID }, rooms: new Set([ROOM_ID]) });
      const emit = vi.fn();
      (socket as any).to = vi.fn().mockReturnValue({ emit });

      await gateway.handleClientIsTyping(socket, { roomId: ROOM_ID, isTyping: true });

      expect((socket as any).to).toHaveBeenCalledWith(ROOM_ID);
      expect(emit).toHaveBeenCalledWith(
        EVENT_NAMES.server.typingUpdate,
        expect.objectContaining({
          roomId: ROOM_ID,
          userId: USER_ID,
          isTyping: true,
        }),
      );
      expect(socket.emit).not.toHaveBeenCalled();
    });

    it('emits typing:update with isTyping false', async () => {
      const socket = makeSocket({ data: { userId: USER_ID }, rooms: new Set([ROOM_ID]) });
      const emit = vi.fn();
      (socket as any).to = vi.fn().mockReturnValue({ emit });

      await gateway.handleClientIsTyping(socket, { roomId: ROOM_ID, isTyping: false });

      expect(emit).toHaveBeenCalledWith(
        EVENT_NAMES.server.typingUpdate,
        expect.objectContaining({
          roomId: ROOM_ID,
          userId: USER_ID,
          isTyping: false,
        }),
      );
    });

    it('emits NOT_ROOM_MEMBER and does not broadcast when not in the room', async () => {
      const socket = makeSocket({ data: { userId: USER_ID }, rooms: new Set() });
      const toEmit = vi.fn();
      (socket as any).to = vi.fn().mockReturnValue({ emit: toEmit });

      await gateway.handleClientIsTyping(socket, { roomId: ROOM_ID, isTyping: true });

      expect((socket as any).to).not.toHaveBeenCalled();
      expect(toEmit).not.toHaveBeenCalled();
      expect(socket.emit).toHaveBeenCalledWith(
        EVENT_NAMES.server.error,
        expect.objectContaining({ code: 'NOT_ROOM_MEMBER' }),
      );
    });
  });

  describe('handleClientSendMessage', () => {
    const message = {
      id: '33333333-3333-4333-8333-333333333333',
      roomId: ROOM_ID,
      content: 'hello',
      author: { id: USER_ID, name: 'User' },
      createdAt: new Date().toISOString(),
    } as any;

    it('emits NOT_ROOM_MEMBER and does not create or broadcast when not a member', async () => {
      const socket = makeSocket({ data: { userId: USER_ID } });
      rooms.isMember.mockResolvedValue(false);

      await gateway.handleClientSendMessage(socket, { roomId: ROOM_ID, content: 'hello' });

      expect(rooms.isMember).toHaveBeenCalledWith(ROOM_ID, USER_ID);
      expect(messages.createMessage).not.toHaveBeenCalled();
      expect(socket.emit).toHaveBeenCalledWith(
        EVENT_NAMES.server.error,
        expect.objectContaining({ code: 'NOT_ROOM_MEMBER' }),
      );
    });

    it('creates message and broadcasts to the room on success', async () => {
      const socket = makeSocket({ data: { userId: USER_ID } });
      const emit = vi.fn();
      const to = vi.fn().mockReturnValue({ emit });
      (gateway as any).io = { to };

      rooms.isMember.mockResolvedValue(true);
      messages.createMessage.mockResolvedValue(message);

      await gateway.handleClientSendMessage(socket, { roomId: ROOM_ID, content: '  hello  ' });

      expect(rooms.isMember).toHaveBeenCalledWith(ROOM_ID, USER_ID);
      expect(messages.createMessage).toHaveBeenCalledWith(ROOM_ID, USER_ID, {
        roomId: ROOM_ID,
        content: '  hello  ',
      });
      expect(to).toHaveBeenCalledWith(ROOM_ID);
      expect(emit).toHaveBeenCalledWith(
        EVENT_NAMES.server.newMessage,
        expect.objectContaining({ message }),
      );
    });

    it('emits EMPTY_MESSAGE when message creation throws BadRequestException', async () => {
      const socket = makeSocket({ data: { userId: USER_ID } });
      (gateway as any).io = { to: vi.fn().mockReturnValue({ emit: vi.fn() }) };

      rooms.isMember.mockResolvedValue(true);
      messages.createMessage.mockRejectedValue(new BadRequestException());

      await gateway.handleClientSendMessage(socket, { roomId: ROOM_ID, content: '   ' });

      expect(socket.emit).toHaveBeenCalledWith(
        EVENT_NAMES.server.error,
        expect.objectContaining({ code: 'EMPTY_MESSAGE' }),
      );
    });

    it('emits INTERNAL_ERROR and logs when message creation throws unexpected error', async () => {
      const socket = makeSocket({ data: { userId: USER_ID } });
      (gateway as any).io = { to: vi.fn().mockReturnValue({ emit: vi.fn() }) };
      const loggerError = vi.spyOn((gateway as any).logger, 'error').mockImplementation(() => {});

      rooms.isMember.mockResolvedValue(true);
      messages.createMessage.mockRejectedValue(new Error('db down'));

      await gateway.handleClientSendMessage(socket, { roomId: ROOM_ID, content: 'hello' });

      expect(socket.emit).toHaveBeenCalledWith(
        EVENT_NAMES.server.error,
        expect.objectContaining({ code: 'INTERNAL_ERROR' }),
      );
      expect(loggerError).toHaveBeenCalled();

      loggerError.mockRestore();
    });
  });
});
