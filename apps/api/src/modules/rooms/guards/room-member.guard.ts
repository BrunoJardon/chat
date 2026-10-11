import {
  BadRequestException,
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Inject,
  Injectable,
  NotFoundException,
  UnauthorizedException,
} from '@nestjs/common';
import type { PrismaClient } from '@chat/database';
import { PRISMA_CLIENT } from '../../../core/database/prisma.constants.js';
import { AuthenticatedRequest } from '../../auth/guards/jwt-auth.guard.js';
import { isUUID } from 'class-validator';

@Injectable()
export class RoomMemberGuard implements CanActivate {
  constructor(
    @Inject(PRISMA_CLIENT)
    private readonly prisma: PrismaClient,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const req = context.switchToHttp().getRequest<AuthenticatedRequest>();

    const roomId = req.params.roomId;
    const userId = req.user;

    if (typeof roomId !== 'string' || roomId.length === 0 || !isUUID(roomId)) {
      throw new BadRequestException('INVALID_ROOM_ID');
    }

    if (!userId?.sub) {
      throw new UnauthorizedException('SESSION_INVALID');
    }

    const room = await this.prisma.room.findUnique({ where: { id: roomId } });
    if (!room) {
      throw new NotFoundException('ROOM_NOT_FOUND');
    }

    const userInRoom = await this.prisma.roomMember.findFirst({
      where: { roomId: room.id, userId: userId.sub },
    });
    if (!userInRoom) {
      throw new ForbiddenException('NOT_ROOM_MEMBER');
    }

    return true;
  }
}
