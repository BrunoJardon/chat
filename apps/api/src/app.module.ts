import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { envValidationSchema } from './config/env.validation.js';
import { PrismaModule } from './core/database/prisma.module.js';
import { RedisModule } from './core/redis/redis.module.js';
import { HealthModule } from './core/health/health.module.js';
import { AuthModule } from './modules/auth/auth.module.js';
import { APP_GUARD } from '@nestjs/core';
import { JwtAuthGuard } from './modules/auth/guards/jwt-auth.guard.js';
import { UsersModule } from './modules/users/users.module.js';
import { RoomsModule } from './modules/rooms/rooms.module.js';
import { MessagesModule } from './modules/messages/messages.module.js';

@Module({
  providers: [
    {
      provide: APP_GUARD,
      useClass: JwtAuthGuard,
    },
  ],
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      envFilePath: ['../../.env', '.env'],
      validationSchema: envValidationSchema,
    }),
    PrismaModule,
    RedisModule,
    HealthModule,
    AuthModule,
    UsersModule,
    RoomsModule,
    MessagesModule,
  ],
})
export class AppModule {}
