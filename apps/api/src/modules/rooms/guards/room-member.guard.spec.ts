import {
  BadRequestException,
  ForbiddenException,
  NotFoundException,
  UnauthorizedException,
} from '@nestjs/common';
import type { ExecutionContext } from '@nestjs/common';
import type { PrismaClient } from '@chat/database';
import { RoomMemberGuard } from './room-member.guard.js';

const USER_ID = '11111111-1111-4111-8111-111111111111';
const ROOM_ID = '33333333-3333-4333-8333-333333333333';

function makePrisma() {
  return {
    room: { findUnique: vi.fn() },
    roomMember: { findFirst: vi.fn() },
  };
}

/** Builds the ExecutionContext the guard sees on a real request. */
function makeContext(user: unknown, params: Record<string, unknown>) {
  const req = { user, params };
  return { switchToHttp: () => ({ getRequest: () => req }) } as unknown as ExecutionContext;
}

describe('RoomMemberGuard', () => {
  let prisma: ReturnType<typeof makePrisma>;
  let guard: RoomMemberGuard;

  beforeEach(() => {
    prisma = makePrisma();
    guard = new RoomMemberGuard(prisma as unknown as PrismaClient);
  });

  it('lets a member through', async () => {
    prisma.room.findUnique.mockResolvedValue({ id: ROOM_ID });
    prisma.roomMember.findFirst.mockResolvedValue({ roomId: ROOM_ID, userId: USER_ID });

    await expect(
      guard.canActivate(makeContext({ sub: USER_ID }, { roomId: ROOM_ID })),
    ).resolves.toBe(true);
  });

  it('throws 403 NOT_ROOM_MEMBER when the caller is not a member', async () => {
    prisma.room.findUnique.mockResolvedValue({ id: ROOM_ID });
    prisma.roomMember.findFirst.mockResolvedValue(null);

    const promise = guard.canActivate(makeContext({ sub: USER_ID }, { roomId: ROOM_ID }));

    await expect(promise).rejects.toBeInstanceOf(ForbiddenException);
    await expect(promise).rejects.toThrow('NOT_ROOM_MEMBER');
    expect(prisma.room.findUnique).toHaveBeenCalledWith({ where: { id: ROOM_ID } });
    expect(prisma.roomMember.findFirst).toHaveBeenCalledWith({
      where: { roomId: ROOM_ID, userId: USER_ID },
    });
  });

  it('throws 404 ROOM_NOT_FOUND and skips the membership check when the room is missing', async () => {
    prisma.room.findUnique.mockResolvedValue(null);

    const promise = guard.canActivate(makeContext({ sub: USER_ID }, { roomId: ROOM_ID }));

    await expect(promise).rejects.toBeInstanceOf(NotFoundException);
    await expect(promise).rejects.toThrow('ROOM_NOT_FOUND');
    expect(prisma.roomMember.findFirst).not.toHaveBeenCalled();
  });

  it('throws 400 INVALID_ROOM_ID for a missing or non-string route param, without querying', async () => {
    for (const params of [{}, { roomId: [ROOM_ID] }, { roomId: '' }]) {
      const promise = guard.canActivate(makeContext({ sub: USER_ID }, params));

      await expect(promise).rejects.toBeInstanceOf(BadRequestException);
      await expect(promise).rejects.toThrow('INVALID_ROOM_ID');
    }
    expect(prisma.room.findUnique).not.toHaveBeenCalled();
  });

  it('throws 401 SESSION_INVALID when the guard cannot see a verified user', async () => {
    const promise = guard.canActivate(makeContext(undefined, { roomId: ROOM_ID }));

    await expect(promise).rejects.toBeInstanceOf(UnauthorizedException);
    await expect(promise).rejects.toThrow('SESSION_INVALID');
    expect(prisma.room.findUnique).not.toHaveBeenCalled();
  });
});
