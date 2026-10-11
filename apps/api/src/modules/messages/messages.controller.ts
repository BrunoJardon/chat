import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { MessagesService } from './messages.service.js';
import { CurrentUser } from '../auth/decorators/current-user.decorator.js';
import { ListMessagesDto } from './dto/list-messages.dto.js';
import { CreateMessageRequestDto } from './dto/create-message.dto.js';
import { RoomMemberGuard } from '../rooms/guards/room-member.guard.js';

@Controller('rooms/:roomId/messages')
@UseGuards(RoomMemberGuard)
export class MessagesController {
  constructor(private readonly messagesService: MessagesService) {}

  @Post()
  @HttpCode(HttpStatus.CREATED)
  createMessage(
    @Param('roomId', new ParseUUIDPipe()) roomId: string,
    @CurrentUser('sub') userId: string,
    @Body() dto: CreateMessageRequestDto,
  ) {
    return this.messagesService.createMessage(roomId, userId, dto);
  }

  @Get()
  @HttpCode(HttpStatus.OK)
  listMessages(
    @Param('roomId', new ParseUUIDPipe()) roomId: string,
    @Query() dto: ListMessagesDto,
  ) {
    return this.messagesService.listRoomMessages(roomId, dto);
  }
}
