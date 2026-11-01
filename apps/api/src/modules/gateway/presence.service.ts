import { Inject, Injectable } from '@nestjs/common';
import type { ServerPresenceEvent } from '@chat/types';
import type { Redis } from 'ioredis';
import { REDIS_CLIENT } from '../../core/redis/redis.constants.js';
import { SOCKET_TTL_SECONDS } from './gateway.constants.js';

/* How long a socket is considered alive without a refresh. If the process dies
  without running `handleDisconnect`, the key expires and the socket is pruned
  on the next read, so a user cannot stay "online" forever. */

const socketKey = (socketId: string): string => `ws:socket:${socketId}`;
const socketsKey = (userId: string): string => `ws:user:${userId}:sockets`;
const lastSeenKey = (userId: string): string => `ws:user:${userId}:lastSeen`;

@Injectable()
export class PresenceService {
  constructor(
    @Inject(REDIS_CLIENT)
    private readonly redis: Redis,
  ) {}

  async setOnline(userId: string, socketId: string): Promise<ServerPresenceEvent | null> {
    await this.redis.set(socketKey(socketId), userId, 'EX', SOCKET_TTL_SECONDS);
    await this.redis.sadd(socketsKey(userId), socketId);

    const count = await this.pruneAndCount(userId);
    if (count !== 1) {
      return null;
    }

    await this.redis.del(lastSeenKey(userId));
    return { userId, status: 'online', lastSeen: null };
  }

  async setOffline(userId: string, socketId: string): Promise<ServerPresenceEvent | null> {
    await this.redis.srem(socketsKey(userId), socketId);
    await this.redis.del(socketKey(socketId));

    const count = await this.pruneAndCount(userId);
    if (count !== 0) {
      return null;
    }

    await this.redis.del(socketsKey(userId));
    const lastSeen = new Date().toISOString();
    await this.redis.set(lastSeenKey(userId), lastSeen);

    return { userId, status: 'offline', lastSeen };
  }

  async getPresence(userId: string): Promise<ServerPresenceEvent> {
    const count = await this.pruneAndCount(userId);
    const lastSeen = await this.redis.get(lastSeenKey(userId));

    return { userId, status: count > 0 ? 'online' : 'offline', lastSeen };
  }

  async getSocketIds(userId: string): Promise<string[]> {
    const count = await this.pruneAndCount(userId);
    if (count === 0) {
      return [];
    }

    return this.redis.smembers(socketsKey(userId));
  }

  async refresh(socketIds: string[]): Promise<void> {
    if (socketIds.length === 0) {
      return;
    }

    const pipeline = this.redis.pipeline();
    for (const socketId of socketIds) {
      pipeline.expire(socketKey(socketId), SOCKET_TTL_SECONDS);
    }
    await pipeline.exec();
  }

  /* Drops sockets whose liveness key expired (crash / unclean disconnect) and
    returns how many live sockets remain. Without this prune, expired members
    would keep inflating the count and the user would never go offline. */
  private async pruneAndCount(userId: string): Promise<number> {
    const key = socketsKey(userId);
    const members = await this.redis.smembers(key);
    if (members.length === 0) {
      return 0;
    }

    const pipeline = this.redis.pipeline();
    for (const socketId of members) {
      pipeline.exists(socketKey(socketId));
    }
    const results = await pipeline.exec();

    const dead: string[] = [];
    members.forEach((socketId, index) => {
      const entry = results?.[index];
      const exists = entry ? Number(entry[1]) : 0;
      if (exists === 0) {
        dead.push(socketId);
      }
    });

    if (dead.length > 0) {
      await this.redis.srem(key, ...dead);
    }

    return members.length - dead.length;
  }
}
