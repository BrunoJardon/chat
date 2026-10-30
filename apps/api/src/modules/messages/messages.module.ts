import { Module } from '@nestjs/common';
import { MessagesController } from './messages.controller.js';
import { MessagesService } from './messages.service.js';
import { RoomsModule } from '../rooms/rooms.module.js';

@Module({
  controllers: [MessagesController],
  providers: [MessagesService],
  imports: [RoomsModule],
  exports: [MessagesService],
})
export class MessagesModule {}
