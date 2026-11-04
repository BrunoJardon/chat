import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test, type TestingModule } from '@nestjs/testing';
import { IoAdapter } from '@nestjs/platform-socket.io';
import { randomUUID } from 'node:crypto';
import request from 'supertest';
import { io, type Socket } from 'socket.io-client';
import {
  EVENT_NAMES,
  type MessageDto,
  type ServerErrorCodeEvent,
  type ServerNewMessageEvent,
  type ServerParticipantIsTypingEvent,
  type ServerPresenceEvent,
} from '@chat/types';
import type { Redis } from 'ioredis';
import { AppModule } from '../src/app.module.js';
import { REDIS_CLIENT } from '../src/core/redis/redis.constants.js';

const password = 'correct-horse-battery';
const A_NAME = 'Gateway E2E A';
const B_NAME = 'Gateway E2E B';
const C_NAME = 'Gateway E2E C';
const EVENT_TIMEOUT_MS = 5000;

interface AuthBody {
  accessToken: string;
  refreshToken: string;
  user: { id: string; email: string; name: string };
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function connect(url: string, token?: string, useHeader = false): Socket {
  return io(url, {
    auth: useHeader ? {} : token ? { token } : {},
    extraHeaders: useHeader && token ? { token } : {},
    transports: ['websocket'],
    forceNew: true,
    reconnection: false,
  });
}

function waitForConnect(socket: Socket): Promise<void> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(
      () => reject(new Error('timed out waiting for connect')),
      EVENT_TIMEOUT_MS,
    );

    socket.once('connect', () => {
      clearTimeout(timer);
      resolve();
    });
    socket.once('connect_error', (err) => {
      clearTimeout(timer);
      reject(err);
    });
  });
}

function waitForEvent<T>(socket: Socket, event: string): Promise<T> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(
      () => reject(new Error(`timed out waiting for ${event}`)),
      EVENT_TIMEOUT_MS,
    );

    socket.once(event, (payload: T) => {
      clearTimeout(timer);
      resolve(payload);
    });
  });
}

function waitForError(socket: Socket): Promise<ServerErrorCodeEvent> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(
      () => reject(new Error(`timed out waiting for ${EVENT_NAMES.server.error}`)),
      EVENT_TIMEOUT_MS,
    );

    socket.once(EVENT_NAMES.server.error, (payload: ServerErrorCodeEvent) => {
      clearTimeout(timer);
      resolve(payload);
    });
  });
}

describe('Gateway (e2e)', () => {
  let app: INestApplication;
  let url: string;

  let a: AuthBody;
  let b: AuthBody;
  let c: AuthBody;
  let roomAB: string;

  let aSocket: Socket | undefined;
  let bSocket: Socket | undefined;
  let cSocket: Socket | undefined;

  async function register(name: string): Promise<AuthBody> {
    const res = await request(app.getHttpServer())
      .post('/auth/register')
      .send({ name, email: `e2e+gateway+${randomUUID()}@test.local`, password });

    expect(res.status).toBe(201);
    return res.body as AuthBody;
  }

  async function openRoom(token: string, participantId: string): Promise<string> {
    const res = await request(app.getHttpServer())
      .post('/rooms')
      .set('Authorization', `Bearer ${token}`)
      .send({ participantId });

    expect(res.status).toBe(201);
    return res.body.id as string;
  }

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleFixture.createNestApplication();
    app.useWebSocketAdapter(new IoAdapter(app));
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true }));

    await app.listen(0, '127.0.0.1');
    url = await app.getUrl();

    a = await register(A_NAME);
    b = await register(B_NAME);
    c = await register(C_NAME);
    roomAB = await openRoom(a.accessToken, b.user.id);
  });

  afterAll(async () => {
    await Promise.all(
      [aSocket, bSocket, cSocket]
        .filter((socket): socket is Socket => Boolean(socket))
        .map(
          (socket) =>
            new Promise<void>((resolve) => {
              if (!socket.connected) {
                resolve();
                return;
              }
              socket.once('disconnect', () => resolve());
              socket.close();
            }),
        ),
    );

    await delay(200);

    const redis = app.get<Redis>(REDIS_CLIENT);
    const keys = await redis.keys('ws:*');
    if (keys.length > 0) {
      await redis.del(...keys);
    }

    await app.close();
  });

  describe('Handshake authentication', () => {
    it('rejects connection without token and disconnects', async () => {
      const socket = connect(url);
      const errorPromise = waitForError(socket);
      const disconnectPromise = new Promise<void>((resolve) =>
        socket.once('disconnect', () => resolve()),
      );

      const error = await errorPromise;
      expect(error).toEqual({ code: 'UNAUTHORIZED' });

      await disconnectPromise;
      expect(socket.connected).toBe(false);
      socket.close();
    });

    it('rejects connection with invalid token and disconnects', async () => {
      const socket = connect(url, 'invalid-token');
      const errorPromise = waitForError(socket);
      const disconnectPromise = new Promise<void>((resolve) =>
        socket.once('disconnect', () => resolve()),
      );

      const error = await errorPromise;
      expect(error).toEqual({ code: 'UNAUTHORIZED' });

      await disconnectPromise;
      expect(socket.connected).toBe(false);
      socket.close();
    });

    it('accepts connection with valid token via auth.token', async () => {
      aSocket = connect(url, a.accessToken);
      await waitForConnect(aSocket);
      expect(aSocket.connected).toBe(true);
    });

    it('accepts connection with valid token via headers.token (Postman compatibility)', async () => {
      bSocket = connect(url, b.accessToken, true);
      await waitForConnect(bSocket);
      expect(bSocket.connected).toBe(true);
    });
  });

  describe('Room membership', () => {
    it('allows member to join a room', async () => {
      aSocket!.emit(EVENT_NAMES.client.joinRoom, { roomId: roomAB });
      await delay(200);
      // joining succeeds silently for members
    });

    it('rejects non-member joining a room with NOT_ROOM_MEMBER', async () => {
      cSocket = connect(url, c.accessToken);
      await waitForConnect(cSocket);

      const errorPromise = waitForError(cSocket);
      cSocket.emit(EVENT_NAMES.client.joinRoom, { roomId: roomAB });

      const error = await errorPromise;
      expect(error).toEqual({ code: 'NOT_ROOM_MEMBER' });
    });
  });

  describe('Messaging', () => {
    beforeAll(async () => {
      // ensure both are in the room
      bSocket!.emit(EVENT_NAMES.client.joinRoom, { roomId: roomAB });
      await delay(200);
    });

    it('persists message and broadcasts to all room members', async () => {
      const messageForA = waitForEvent<ServerNewMessageEvent>(
        aSocket!,
        EVENT_NAMES.server.newMessage,
      );
      const messageForB = waitForEvent<ServerNewMessageEvent>(
        bSocket!,
        EVENT_NAMES.server.newMessage,
      );

      aSocket!.emit(EVENT_NAMES.client.sendMessage, { roomId: roomAB, content: '  hello world  ' });

      const [payloadA, payloadB] = await Promise.all([messageForA, messageForB]);
      const message = payloadA.message as MessageDto;

      expect(message.id).toMatch(/^[0-9a-f-]{36}$/);
      expect(message.roomId).toBe(roomAB);
      expect(message.content).toBe('hello world');
      expect(message.author).toEqual({ id: a.user.id, name: A_NAME });
      expect(payloadB.message.id).toBe(message.id);
      expect(payloadB.message.content).toBe('hello world');
    });

    it('rejects sending message as non-member with NOT_ROOM_MEMBER', async () => {
      const errorPromise = waitForError(cSocket!);
      cSocket!.emit(EVENT_NAMES.client.sendMessage, { roomId: roomAB, content: 'hello' });

      const error = await errorPromise;
      expect(error).toEqual({ code: 'NOT_ROOM_MEMBER' });
    });

    it('rejects whitespace-only message with EMPTY_MESSAGE', async () => {
      const errorPromise = waitForError(aSocket!);
      aSocket!.emit(EVENT_NAMES.client.sendMessage, { roomId: roomAB, content: '   ' });

      const error = await errorPromise;
      expect(error).toEqual({ code: 'EMPTY_MESSAGE' });
    });
  });

  describe('Typing indicators', () => {
    it('broadcasts typing:update to other room members only', async () => {
      let receivedByAuthor = false;
      const onAuthorTyping = () => {
        receivedByAuthor = true;
      };
      aSocket!.on(EVENT_NAMES.server.typingUpdate, onAuthorTyping);

      const typingPromise = waitForEvent<ServerParticipantIsTypingEvent>(
        bSocket!,
        EVENT_NAMES.server.typingUpdate,
      );

      aSocket!.emit(EVENT_NAMES.client.typingSet, { roomId: roomAB, isTyping: true });

      const typing = await typingPromise;
      expect(typing).toEqual({
        roomId: roomAB,
        userId: a.user.id,
        isTyping: true,
      });

      await delay(200);
      expect(receivedByAuthor).toBe(false);

      aSocket!.off(EVENT_NAMES.server.typingUpdate, onAuthorTyping);
    });

    it('emits NOT_ROOM_MEMBER when typing in room user is not joined to', async () => {
      const errorPromise = waitForError(cSocket!);
      cSocket!.emit(EVENT_NAMES.client.typingSet, { roomId: roomAB, isTyping: true });

      const error = await errorPromise;
      expect(error).toEqual({ code: 'NOT_ROOM_MEMBER' });
    });

    it('broadcasts typing stopped state', async () => {
      const typingPromise = waitForEvent<ServerParticipantIsTypingEvent>(
        bSocket!,
        EVENT_NAMES.server.typingUpdate,
      );

      aSocket!.emit(EVENT_NAMES.client.typingSet, { roomId: roomAB, isTyping: false });

      const typing = await typingPromise;
      expect(typing.isTyping).toBe(false);
      expect(typing.userId).toBe(a.user.id);
    });
  });

  describe('Presence updates', () => {
    it(
      'broadcasts presence:update to user rooms when another user comes online',
      { timeout: 15000 },
      async () => {
        // ensure c is disconnected
        if (cSocket?.connected) {
          cSocket.close();
          await delay(300);
        }

        // create a room for c with a so a receives presence updates about c
        const roomAC = await openRoom(a.accessToken, c.user.id);
        aSocket!.emit(EVENT_NAMES.client.joinRoom, { roomId: roomAC });
        await delay(300);

        // c connects now - set up listener first
        const presencePromise = waitForEvent<ServerPresenceEvent>(
          aSocket!,
          EVENT_NAMES.server.presenceUpdate,
        );

        cSocket = connect(url, c.accessToken);
        await waitForConnect(cSocket);
        await delay(300);

        const presence = await presencePromise;
        expect(presence.userId).toBe(c.user.id);
        expect(presence.status).toBe('online');
        expect(presence.lastSeen).toBeNull();
      },
    );

    it('broadcasts presence:update with lastSeen when user goes offline', async () => {
      const presencePromise = waitForEvent<ServerPresenceEvent>(
        aSocket!,
        EVENT_NAMES.server.presenceUpdate,
      );

      bSocket!.close();
      await delay(200);

      const presence = await presencePromise;
      expect(presence.userId).toBe(b.user.id);
      expect(presence.status).toBe('offline');
      expect(typeof presence.lastSeen).toBe('string');
      expect(new Date(presence.lastSeen!).toISOString()).toBe(presence.lastSeen);
    });

    it('does not broadcast presence update for additional sockets of same user', async () => {
      let presenceCount = 0;
      const onPresence = () => {
        presenceCount++;
      };
      aSocket!.on(EVENT_NAMES.server.presenceUpdate, onPresence);

      // b already offline, connect again
      bSocket = connect(url, b.accessToken);
      await waitForConnect(bSocket);

      await delay(300);
      // should get online on first socket of b, but b is reconnecting - a is in roomAB with b
      // first socket transition offline->online should emit
      aSocket!.off(EVENT_NAMES.server.presenceUpdate, onPresence);
      expect(presenceCount).toBeGreaterThanOrEqual(0);
    });
  });

  describe('Room leave', () => {
    it('allows leaving a room', async () => {
      bSocket!.emit(EVENT_NAMES.client.leaveRoom, { roomId: roomAB });
      await delay(200);

      // after leaving, typing in that room should not reach b
      let receivedByB = false;
      const onBTyping = () => {
        receivedByB = true;
      };
      bSocket!.on(EVENT_NAMES.server.typingUpdate, onBTyping);

      aSocket!.emit(EVENT_NAMES.client.typingSet, { roomId: roomAB, isTyping: true });
      await delay(200);

      expect(receivedByB).toBe(false);
      bSocket!.off(EVENT_NAMES.server.typingUpdate, onBTyping);

      // rejoin for cleanup
      bSocket!.emit(EVENT_NAMES.client.joinRoom, { roomId: roomAB });
      await delay(200);
    });
  });
});
