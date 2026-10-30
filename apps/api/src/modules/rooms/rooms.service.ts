import { BadRequestException, Inject, Injectable, NotFoundException } from '@nestjs/common';
import { PRISMA_CLIENT } from '../../core/database/prisma.constants.js';
import type { PrismaClient } from '@chat/database';
import type { RoomDetail } from '@chat/types';

/** A Room with the members include the service reuses for every read. */
type RoomWithMembers = {
  id: string;
  type: RoomDetail['type'];
  members: { user: { id: string; name: string } }[];
};

const roomDetailsInclude = {
  members: { include: { user: { select: { id: true, name: true } } } },
};

@Injectable()
export class RoomsService {
  constructor(
    @Inject(PRISMA_CLIENT)
    private readonly prisma: PrismaClient,
  ) {}

  private toDetail(room: RoomWithMembers): RoomDetail {
    return {
      id: room.id,
      type: room.type,
      participants: room.members.map((member) => ({ id: member.user.id, name: member.user.name })),
    };
  }

  async isMember(roomId: string, userId: string) {
    const userInRoom = await this.prisma.roomMember.findFirst({
      where: { roomId: roomId, userId: userId },
    });
    if (!userInRoom) {
      return false;
    }

    return true;
  }

  async getRoomDetails(roomId: string): Promise<RoomDetail> {
    const room = await this.prisma.room.findUnique({
      where: { id: roomId },
      include: roomDetailsInclude,
    });
    if (!room) {
      throw new NotFoundException('ROOM_NOT_FOUND');
    }

    return this.toDetail(room);
  }

  async listRooms(userId: string): Promise<RoomDetail[]> {
    const rooms = await this.prisma.room.findMany({
      where: { members: { some: { userId: userId } } },
      orderBy: { createdAt: 'desc' },
      include: roomDetailsInclude,
    });

    return rooms.map((room) => this.toDetail(room));
  }

  async createRoom(participantId: string, userId: string): Promise<RoomDetail> {
    if (participantId === userId) {
      throw new BadRequestException('SELF_PARTICIPANT');
    }

    const participant = await this.prisma.user.findUnique({
      where: { id: participantId },
      select: { id: true, name: true, password: false },
    });
    if (!participant) {
      throw new NotFoundException('USER_NOT_FOUND');
    }

    const existingRoom = await this.prisma.room.findFirst({
      where: {
        type: 'private',
        AND: [
          { members: { some: { userId: userId } } },
          { members: { some: { userId: participantId } } },
        ],
      },
    });
    if (existingRoom) {
      return this.getRoomDetails(existingRoom.id);
    }

    const room = await this.prisma.$transaction(async (tx) => {
      const created = await tx.room.create({ data: { type: 'private' } });

      await tx.roomMember.createMany({
        data: [
          { roomId: created.id, userId: userId },
          { roomId: created.id, userId: participantId },
        ],
      });

      return created;
    });

    return this.getRoomDetails(room.id);
  }
}
