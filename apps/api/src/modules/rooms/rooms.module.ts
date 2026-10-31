import { Module } from '@nestjs/common';
import { RoomsController } from './rooms.controller.js';
import { RoomsService } from './rooms.service.js';
import { RoomMemberGuard } from './guards/room-member.guard.js';

@Module({
  controllers: [RoomsController],
  providers: [RoomsService, RoomMemberGuard],
  exports: [RoomsService, RoomMemberGuard],
})
export class RoomsModule {}
