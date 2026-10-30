import { Module } from '@nestjs/common';
import { ChatGateway } from './chat.gateway.js';
import { AuthModule } from '../auth/auth.module.js';
import { MessagesModule } from '../messages/messages.module.js';
import { RoomsModule } from '../rooms/rooms.module.js';

@Module({
  imports: [RoomsModule, AuthModule, MessagesModule],
  providers: [ChatGateway],
})
export class GatewayModule {}
