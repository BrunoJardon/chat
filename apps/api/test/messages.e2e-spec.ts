import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test, type TestingModule } from '@nestjs/testing';
import { randomUUID } from 'node:crypto';
import request from 'supertest';
import type { MessageDto, MessagesPage } from '@chat/types';
import { AppModule } from '../src/app.module.js';

// Requires postgres + redis running (docker compose up -d), same as the other
// e2e suites. The suite is repeatable: every registered email is unique.
const password = 'correct-horse-battery';
const A_NAME = 'Messages E2E A';
const B_NAME = 'Messages E2E B';
const C_NAME = 'Messages E2E C';

interface AuthBody {
  accessToken: string;
  refreshToken: string;
  user: { id: string; email: string; name: string };
}

describe('Messages (e2e)', () => {
  let app: INestApplication;

  // Flow state. Vitest runs the tests of a file sequentially, in declaration
  // order, so the lifecycle below is deterministic.
  let a: AuthBody;
  let b: AuthBody;
  let c: AuthBody;
  let roomAB: string;

  async function register(name: string): Promise<AuthBody> {
    const res = await request(app.getHttpServer())
      .post('/auth/register')
      .send({ name, email: `e2e+messages+${randomUUID()}@test.local`, password });

    expect(res.status).toBe(201);
    return res.body as AuthBody;
  }

  function createRoom(token: string, participantId: string) {
    return request(app.getHttpServer())
      .post('/rooms')
      .set('Authorization', `Bearer ${token}`)
      .send({ participantId });
  }

  function postMessage(token: string, roomId: string, content: string) {
    return request(app.getHttpServer())
      .post(`/rooms/${roomId}/messages`)
      .set('Authorization', `Bearer ${token}`)
      .send({ content });
  }

  function listMessages(token: string, roomId: string, query = '') {
    return request(app.getHttpServer())
      .get(`/rooms/${roomId}/messages${query}`)
      .set('Authorization', `Bearer ${token}`);
  }

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleFixture.createNestApplication();
    // Same global pipe as main.ts, so DTO validation behaves like in production.
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true }));
    await app.init();
  });

  afterAll(async () => {
    await app.close();
  });

  it('registers users A, B and C and opens the A–B room', async () => {
    a = await register(A_NAME);
    b = await register(B_NAME);
    c = await register(C_NAME);

    const res = await createRoom(a.accessToken, b.user.id);
    expect(res.status).toBe(201);
    roomAB = res.body.id as string;
  });

  describe('POST /rooms/:roomId/messages', () => {
    it('creates a message, trims its content and returns it with an inline author (201)', async () => {
      const res = await postMessage(a.accessToken, roomAB, '  hello  ');

      expect(res.status).toBe(201);
      const message = res.body as MessageDto;
      expect(message.id).toMatch(/^[0-9a-f-]{36}$/);
      expect(message.roomId).toBe(roomAB);
      expect(message.content).toBe('hello');
      expect(message.author).toEqual({ id: a.user.id, name: A_NAME });
      expect(typeof message.createdAt).toBe('string');
      // A real ISO instant: re-serializing it is a no-op.
      expect(new Date(message.createdAt).toISOString()).toBe(message.createdAt);
      // The author projection (and the row) never carries sensitive columns.
      expect(message).not.toHaveProperty('authorId');
      expect(message.author).not.toHaveProperty('email');
      expect(message.author).not.toHaveProperty('password');
    });

    it('rejects whitespace-only content with 400 EMPTY_MESSAGE', async () => {
      const res = await postMessage(a.accessToken, roomAB, '    ');

      expect(res.status).toBe(400);
      expect(res.body.message).toBe('EMPTY_MESSAGE');
    });
  });

  describe('GET /rooms/:roomId/messages', () => {
    // A dedicated room, so this suite's own POSTs cannot pollute the page.
    let roomAC: string;
    // Message ids in creation order (oldest → newest): sent[0] is 'm1'.
    const sent: string[] = [];

    beforeAll(async () => {
      const room = await createRoom(a.accessToken, c.user.id);
      expect(room.status).toBe(201);
      roomAC = room.body.id as string;

      for (const content of ['m1', 'm2', 'm3', 'm4', 'm5']) {
        const res = await postMessage(a.accessToken, roomAC, content);
        expect(res.status).toBe(201);
        sent.push(res.body.id as string);
      }
    });

    it('returns the whole page oldest → newest and no cursor', async () => {
      const res = await listMessages(a.accessToken, roomAC);

      expect(res.status).toBe(200);
      const page = res.body as MessagesPage;
      expect(page.messages.map((m) => m.id)).toEqual(sent);
      expect(page.messages.map((m) => m.content)).toEqual(['m1', 'm2', 'm3', 'm4', 'm5']);
      expect(page.hasMore).toBe(false);
      expect(page.nextCursor).toBeNull();
    });

    it('walks every page with limit=2 without gaps or duplicates', async () => {
      // Pages are served newest-first, each internally ascending; the cursor
      // points at the oldest row of the returned page. With 5 messages and
      // limit 2 this is exactly 3 pages.
      const expected = [
        { contents: ['m4', 'm5'], hasMore: true, nextCursor: 'm4' },
        { contents: ['m2', 'm3'], hasMore: true, nextCursor: 'm2' },
        { contents: ['m1'], hasMore: false, nextCursor: null },
      ] as const;
      const idByContent = new Map(['m1', 'm2', 'm3', 'm4', 'm5'].map((x, i) => [x, sent[i]]));

      const seen: string[] = [];
      let cursor: string | null = null;

      for (const step of expected) {
        const query = cursor ? `?limit=2&before=${cursor}` : '?limit=2';
        const res = await listMessages(a.accessToken, roomAC, query);

        expect(res.status).toBe(200);
        const page = res.body as MessagesPage;
        expect(page.messages.map((m) => m.content)).toEqual(step.contents);
        expect(page.hasMore).toBe(step.hasMore);
        const expectedCursor = step.nextCursor ? (idByContent.get(step.nextCursor) ?? null) : null;
        expect(page.nextCursor).toBe(expectedCursor);

        seen.push(...page.messages.map((m) => m.id));
        cursor = page.nextCursor;
      }

      expect(seen).toHaveLength(5);
      expect(new Set(seen).size).toBe(5); // no duplicates
      expect(new Set(seen)).toEqual(new Set(sent)); // no gaps
    });
  });

  describe('access control and query validation', () => {
    it('returns 401 without a token on POST and on GET', async () => {
      const post = await request(app.getHttpServer())
        .post(`/rooms/${roomAB}/messages`)
        .send({ content: 'x' });
      const get = await request(app.getHttpServer()).get(`/rooms/${roomAB}/messages`);

      expect(post.status).toBe(401);
      expect(get.status).toBe(401);
      expect(post.body.message).toBe('MISSING_BEARER_TOKEN');
    });

    it('returns 403 NOT_ROOM_MEMBER for a non-member on POST and on GET', async () => {
      const post = await postMessage(c.accessToken, roomAB, 'intruder');
      const get = await listMessages(c.accessToken, roomAB);

      expect(post.status).toBe(403);
      expect(get.status).toBe(403);
      expect(post.body.message).toBe('NOT_ROOM_MEMBER');
      expect(get.body.message).toBe('NOT_ROOM_MEMBER');
    });

    it('returns 404 ROOM_NOT_FOUND for an unknown room', async () => {
      const res = await listMessages(a.accessToken, randomUUID());

      expect(res.status).toBe(404);
      expect(res.body.message).toBe('ROOM_NOT_FOUND');
    });

    it('returns 400 for a `before` cursor that is not a uuid', async () => {
      const res = await listMessages(a.accessToken, roomAB, '?before=not-a-uuid');

      expect(res.status).toBe(400);
      expect(res.body.message).toEqual(expect.any(Array));
    });
  });

  describe('limit DTO bounds', () => {
    it('rejects a limit below 1 or above the page cap with 400', async () => {
      for (const limit of [0, -1, 51]) {
        const res = await listMessages(a.accessToken, roomAB, `?limit=${limit}`);

        expect(res.status).toBe(400);
        expect(res.body.message).toEqual(expect.any(Array));
      }
    });

    it('accepts the boundary limits (1 and the page cap of 50)', async () => {
      for (const limit of [1, 50]) {
        const res = await listMessages(a.accessToken, roomAB, `?limit=${limit}`);

        expect(res.status).toBe(200);
      }
    });

    it('rejects a non-numeric limit with 400', async () => {
      const res = await listMessages(a.accessToken, roomAB, '?limit=abc');

      expect(res.status).toBe(400);
    });
  });
});
