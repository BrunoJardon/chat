import { Module } from '@nestjs/common';
import { ChatGateway } from './chat.gateway.js';
import { RoomsModule } from '../rooms/rooms.module.js';
import { AuthModule } from '../auth/auth.module.js';
import { MessagesModule } from '../messages/messages.module.js';
import { PresenceService } from './presence.service.js';

@Module({
  imports: [RoomsModule, AuthModule, MessagesModule],
  providers: [ChatGateway, PresenceService],
})
export class GatewayModule {}
