import { BadRequestException } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { PRISMA_CLIENT } from '../../core/database/prisma.constants.js';
import { MessagesService } from './messages.service.js';
import { PAGINATION_TAKEN_LIMIT } from './messages.constants.js';

const USER_ID = '11111111-1111-4111-8111-111111111111';
const ROOM_ID = '33333333-3333-4333-8333-333333333333';

// Message ids we control, in chronological order (M1 oldest → M5 newest).
const M1 = '00000000-0000-4000-8000-000000000001';
const M2 = '00000000-0000-4000-8000-000000000002';
const M3 = '00000000-0000-4000-8000-000000000003';
const M4 = '00000000-0000-4000-8000-000000000004';
const M5 = '00000000-0000-4000-8000-000000000005';

const at = (seconds: number) => new Date(Date.UTC(2026, 0, 1, 0, 0, seconds));
const T1 = at(1);
const T2 = at(2);
const T3 = at(3);
const T4 = at(4);
const T5 = at(5);

/** The projection both `create` and `findMany` are pinned to. */
const messageSelect = {
  id: true,
  roomId: true,
  author: { select: { id: true, name: true } },
  content: true,
  createdAt: true,
};

const messageOrderBy = [{ createdAt: 'desc' }, { id: 'desc' }];

function makePrisma() {
  return { message: { create: vi.fn(), findMany: vi.fn() } };
}

/** A Message row shaped like the `select` above (author inlined, Date createdAt). */
function messageRow(id: string, content: string, createdAt: Date) {
  return {
    id,
    roomId: ROOM_ID,
    author: { id: USER_ID, name: 'Ada' },
    content,
    createdAt,
  };
}

/**
 * Unwraps the value a promise rejected with. `.catch()` would type the result
 * as a union with the resolved value, so the `then` pair is used to keep it
 * unknown.
 */
function rejection(promise: Promise<unknown>): Promise<unknown> {
  return promise.then(
    () => undefined,
    (error: unknown) => error,
  );
}

describe('MessagesService', () => {
  let prisma: ReturnType<typeof makePrisma>;
  let service: MessagesService;

  beforeEach(async () => {
    prisma = makePrisma();

    // MessagesService injects the prisma client through the global PRISMA_CLIENT
    // token (see the comment in users.service.spec.ts: it must be a real
    // provider, not an override).
    const module: TestingModule = await Test.createTestingModule({
      providers: [MessagesService, { provide: PRISMA_CLIENT, useValue: prisma }],
    }).compile();

    service = module.get<MessagesService>(MessagesService);
  });

  describe('createMessage', () => {
    it('trims the content before writing and returns the persisted message', async () => {
      prisma.message.create.mockResolvedValue(messageRow(M1, 'hello', T1));

      const result = await service.createMessage(ROOM_ID, USER_ID, { content: '  hello  ' });

      expect(prisma.message.create).toHaveBeenCalledWith({
        data: { roomId: ROOM_ID, content: 'hello', authorId: USER_ID },
        select: messageSelect,
      });
      expect(result).toEqual({
        id: M1,
        roomId: ROOM_ID,
        author: { id: USER_ID, name: 'Ada' },
        content: 'hello',
        createdAt: T1.toISOString(),
      });
    });

    it('throws 400 EMPTY_MESSAGE for whitespace-only content, without touching the database', async () => {
      // `''` also reaches here when the service is called directly (the DTO
      // already rejects it over HTTP, but the service is the real authority).
      for (const content of ['', '   ', '\n\t ']) {
        const promise = service.createMessage(ROOM_ID, USER_ID, { content });

        await expect(promise).rejects.toBeInstanceOf(BadRequestException);
        await expect(promise).rejects.toThrow('EMPTY_MESSAGE');
        const error = await rejection(promise);
        expect((error as BadRequestException).getStatus()).toBe(400);
      }
      expect(prisma.message.create).not.toHaveBeenCalled();
    });

    it('returns an inline author projection and an ISO createdAt string', async () => {
      prisma.message.create.mockResolvedValue(messageRow(M1, 'hi', T1));

      const result = await service.createMessage(ROOM_ID, USER_ID, { content: 'hi' });

      // The response shape: a nested { id, name } author, never a flat authorId
      // and never the author's email/password.
      expect(result.author).toEqual({ id: USER_ID, name: 'Ada' });
      expect(result).not.toHaveProperty('authorId');
      expect(result).not.toHaveProperty('email');
      // createdAt is serialized by the service, not left as a Date.
      expect(typeof result.createdAt).toBe('string');
      expect(result.createdAt).toBe(T1.toISOString());
    });
  });

  describe('listRoomMessages', () => {
    it('returns an ascending page (oldest first) with no more pages when no cursor is given', async () => {
      // The database returns newest first; the service reverses the page.
      prisma.message.findMany.mockResolvedValue([
        messageRow(M3, 'third', T3),
        messageRow(M2, 'second', T2),
        messageRow(M1, 'first', T1),
      ]);

      const result = await service.listRoomMessages(ROOM_ID, {});

      expect(prisma.message.findMany).toHaveBeenCalledWith({
        where: { roomId: ROOM_ID },
        select: messageSelect,
        take: PAGINATION_TAKEN_LIMIT + 1,
        skip: 0,
        cursor: undefined,
        orderBy: messageOrderBy,
      });
      expect(result.messages.map((m) => m.id)).toEqual([M1, M2, M3]);
      expect(result.messages.map((m) => m.createdAt)).toEqual([
        T1.toISOString(),
        T2.toISOString(),
        T3.toISOString(),
      ]);
      expect(result.hasMore).toBe(false);
      expect(result.nextCursor).toBeNull();
    });

    it('honours `before` + `limit`: skips the cursor row and takes limit + 1', async () => {
      // Only two older rows exist, so the limit+1 probe finds nothing extra.
      prisma.message.findMany.mockResolvedValue([
        messageRow(M2, 'second', T2),
        messageRow(M1, 'first', T1),
      ]);

      const result = await service.listRoomMessages(ROOM_ID, { before: M3, limit: 2 });

      expect(prisma.message.findMany).toHaveBeenCalledWith({
        where: { roomId: ROOM_ID },
        select: messageSelect,
        take: 3,
        skip: 1,
        cursor: { id: M3 },
        orderBy: messageOrderBy,
      });
      expect(result.messages.map((m) => m.id)).toEqual([M1, M2]);
      expect(result.hasMore).toBe(false);
      expect(result.nextCursor).toBeNull();
    });

    it('falls back to the default page size when `limit` is undefined', async () => {
      prisma.message.findMany.mockResolvedValue([]);

      await service.listRoomMessages(ROOM_ID, {});

      expect(prisma.message.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ take: PAGINATION_TAKEN_LIMIT + 1, skip: 0 }),
      );
    });

    it('returns an empty page when the cursor matches no rows', async () => {
      prisma.message.findMany.mockResolvedValue([]);

      const result = await service.listRoomMessages(ROOM_ID, { before: M5, limit: 2 });

      expect(result).toEqual({ messages: [], hasMore: false, nextCursor: null });
    });

    it('detects hasMore and points nextCursor at the oldest row of the page', async () => {
      // limit 2 → take 3. The third (extra) row is the hasMore probe.
      prisma.message.findMany.mockResolvedValue([
        messageRow(M5, 'fifth', T5),
        messageRow(M4, 'fourth', T4),
        messageRow(M3, 'third', T3),
      ]);

      const result = await service.listRoomMessages(ROOM_ID, { limit: 2 });

      expect(result.messages.map((m) => m.id)).toEqual([M4, M5]);
      expect(result.hasMore).toBe(true);
      // The cursor is the oldest row of the RETURNED page (M4), not the extra
      // probe row (M3): otherwise the next page would skip M3.
      expect(result.nextCursor).toBe(M4);
      expect(result.nextCursor).not.toBe(M3);
    });
  });
});
