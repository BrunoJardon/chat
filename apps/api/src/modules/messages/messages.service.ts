import { BadRequestException, Inject, Injectable } from '@nestjs/common';
import { PRISMA_CLIENT } from '../../core/database/prisma.constants.js';
import type { PrismaClient } from '@chat/database';
import { PAGINATION_TAKEN_LIMIT } from './messages.constants.js';
import { MessageDto, MessagesPage } from '@chat/types';
import { CreateMessageRequestDto } from './dto/create-message.dto.js';
import { ListMessagesDto } from './dto/list-messages.dto.js';

@Injectable()
export class MessagesService {
  constructor(
    @Inject(PRISMA_CLIENT)
    private readonly prisma: PrismaClient,
  ) {}

  private async getRoomMessages(roomId: string, cursor?: string, limit?: number) {
    if (!limit) {
      limit = PAGINATION_TAKEN_LIMIT;
    }

    const data = await this.prisma.message.findMany({
      where: { roomId: roomId },
      select: {
        id: true,
        roomId: true,
        author: { select: { id: true, name: true } },
        content: true,
        createdAt: true,
      },
      take: limit + 1,
      skip: cursor ? 1 : 0,
      cursor: cursor
        ? {
            id: cursor,
          }
        : undefined,
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
    });

    const messages = data.map((m) => ({
      ...m,
      createdAt: m.createdAt.toISOString(),
    }));

    return messages;
  }

  async listRoomMessages(roomId: string, dto: ListMessagesDto): Promise<MessagesPage> {
    const limit = dto.limit ?? PAGINATION_TAKEN_LIMIT;

    const data = await this.getRoomMessages(roomId, dto.before, limit);

    const pageRaw = data.slice(0, limit).reverse();
    const hasMore = data.length > limit;
    const nextCursor = hasMore ? pageRaw[0].id : null;

    const messages: MessageDto[] = pageRaw;
    return { messages, hasMore, nextCursor };
  }

  async createMessage(
    roomId: string,
    userId: string,
    dto: CreateMessageRequestDto,
  ): Promise<MessageDto> {
    const content = dto.content.trim();
    if (content === '') {
      throw new BadRequestException('EMPTY_MESSAGE');
    }

    const message = await this.prisma.message.create({
      data: { roomId, content, authorId: userId },
      select: {
        id: true,
        roomId: true,
        author: { select: { id: true, name: true } },
        content: true,
        createdAt: true,
      },
    });

    return { ...message, createdAt: message.createdAt.toISOString() };
  }
}
