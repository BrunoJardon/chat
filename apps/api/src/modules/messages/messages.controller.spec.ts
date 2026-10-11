import 'reflect-metadata';
import { BadRequestException, ParseUUIDPipe } from '@nestjs/common';
import { ROUTE_ARGS_METADATA } from '@nestjs/common/constants';
import type { MessageDto, MessagesPage } from '@chat/types';
import { MessagesController } from './messages.controller.js';
import type { MessagesService } from './messages.service.js';
import type { CreateMessageRequestDto } from './dto/create-message.dto.js';
import type { ListMessagesDto } from './dto/list-messages.dto.js';

const USER_ID = '11111111-1111-4111-8111-111111111111';
const ROOM_ID = '33333333-3333-4333-8333-333333333333';
const CURSOR_ID = '00000000-0000-4000-8000-000000000002';

function makeMessagesService() {
  return {
    createMessage: vi.fn(),
    listRoomMessages: vi.fn(),
  };
}

const messageDto: MessageDto = {
  id: '00000000-0000-4000-8000-000000000001',
  roomId: ROOM_ID,
  author: { id: USER_ID, name: 'Ada' },
  content: 'hello',
  createdAt: '2026-01-01T00:00:01.000Z',
};

const page: MessagesPage = {
  messages: [messageDto],
  hasMore: false,
  nextCursor: null,
};

interface RouteArg {
  index: number;
  data?: string;
  pipes: unknown[];
}

/** Reads the route-arg metadata Nest stores for a handler's `roomId` param. */
function roomIdRouteArg(method: 'createMessage' | 'listMessages'): RouteArg | undefined {
  const metadata = Reflect.getMetadata(ROUTE_ARGS_METADATA, MessagesController, method) as
    Record<string, RouteArg> | undefined;
  return Object.values(metadata ?? {}).find((arg) => arg.data === 'roomId');
}

describe('MessagesController', () => {
  let messagesService: ReturnType<typeof makeMessagesService>;
  let controller: MessagesController;

  beforeEach(() => {
    messagesService = makeMessagesService();
    controller = new MessagesController(messagesService as unknown as MessagesService);
  });

  describe('POST /rooms/:roomId/messages', () => {
    it('delegates the route param, the token subject and the body dto to createMessage', async () => {
      const dto: CreateMessageRequestDto = { content: 'hello' };
      messagesService.createMessage.mockResolvedValue(messageDto);

      const result = await controller.createMessage(ROOM_ID, USER_ID, dto);

      expect(messagesService.createMessage).toHaveBeenCalledWith(ROOM_ID, USER_ID, dto);
      expect(result).toBe(messageDto);
    });

    it('propagates 400 EMPTY_MESSAGE untouched', async () => {
      messagesService.createMessage.mockRejectedValue(new BadRequestException('EMPTY_MESSAGE'));

      const promise = controller.createMessage(ROOM_ID, USER_ID, { content: '   ' });

      await expect(promise).rejects.toBeInstanceOf(BadRequestException);
      await expect(promise).rejects.toThrow('EMPTY_MESSAGE');
    });
  });

  describe('GET /rooms/:roomId/messages', () => {
    it('delegates the route param and the query dto to listRoomMessages', async () => {
      const dto: ListMessagesDto = { before: CURSOR_ID, limit: 2 };
      messagesService.listRoomMessages.mockResolvedValue(page);

      const result = await controller.listMessages(ROOM_ID, dto);

      expect(messagesService.listRoomMessages).toHaveBeenCalledWith(ROOM_ID, dto);
      expect(result).toBe(page);
    });
  });

  describe('route param validation', () => {
    // Guards run before pipes, so a real request still reaches RoomMemberGuard
    // first; this pins that the controller wires the pipe at all (both methods).
    it.each(['createMessage', 'listMessages'] as const)(
      'parses :roomId with a ParseUUIDPipe on %s',
      (method) => {
        const arg = roomIdRouteArg(method);

        expect(arg).toBeDefined();
        expect(arg?.index).toBe(0);
        expect(arg?.pipes.some((pipe) => pipe instanceof ParseUUIDPipe)).toBe(true);
      },
    );
  });
});
