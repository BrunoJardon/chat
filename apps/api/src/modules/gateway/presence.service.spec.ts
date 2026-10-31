import type { Redis } from 'ioredis';
import { PresenceService } from './presence.service.js';

const USER_ID = '11111111-1111-4111-8111-111111111111';
const SOCKET_A = 'socket-a';
const SOCKET_B = 'socket-b';

type PipelineResult = [Error | null, unknown][];

function makePipeline(results: PipelineResult) {
  const pipeline = {
    exists: vi.fn(),
    expire: vi.fn(),
    exec: vi.fn().mockResolvedValue(results),
  };
  pipeline.exists.mockReturnValue(pipeline);
  pipeline.expire.mockReturnValue(pipeline);
  return pipeline;
}

function makeRedis() {
  return {
    set: vi.fn().mockResolvedValue('OK'),
    del: vi.fn().mockResolvedValue(1),
    get: vi.fn().mockResolvedValue(null),
    sadd: vi.fn().mockResolvedValue(1),
    srem: vi.fn().mockResolvedValue(1),
    smembers: vi.fn().mockResolvedValue([]),
    pipeline: vi.fn(),
  };
}

describe('PresenceService', () => {
  let redis: ReturnType<typeof makeRedis>;
  let service: PresenceService;

  beforeEach(() => {
    redis = makeRedis();
    service = new PresenceService(redis as unknown as Redis);
  });

  describe('setOnline', () => {
    it('emits online on the first live socket and clears lastSeen', async () => {
      redis.smembers.mockResolvedValue([SOCKET_A]);
      redis.pipeline.mockReturnValue(makePipeline([[null, 1]]));

      const event = await service.setOnline(USER_ID, SOCKET_A);

      expect(redis.set).toHaveBeenCalledWith(`ws:socket:${SOCKET_A}`, USER_ID, 'EX', 60);
      expect(redis.sadd).toHaveBeenCalledWith(`ws:user:${USER_ID}:sockets`, SOCKET_A);
      expect(event).toEqual({ userId: USER_ID, status: 'online', lastSeen: null });
      expect(redis.del).toHaveBeenCalledWith(`ws:user:${USER_ID}:lastSeen`);
    });

    it('stays silent when the user already has another live socket', async () => {
      redis.smembers.mockResolvedValue([SOCKET_A, SOCKET_B]);
      redis.pipeline.mockReturnValue(
        makePipeline([
          [null, 1],
          [null, 1],
        ]),
      );

      const event = await service.setOnline(USER_ID, SOCKET_B);

      expect(event).toBeNull();
      expect(redis.del).not.toHaveBeenCalled();
    });
  });

  describe('setOffline', () => {
    it('stays silent while another socket is still alive', async () => {
      redis.smembers.mockResolvedValue([SOCKET_B]);
      redis.pipeline.mockReturnValue(makePipeline([[null, 1]]));

      const event = await service.setOffline(USER_ID, SOCKET_A);

      expect(redis.srem).toHaveBeenCalledWith(`ws:user:${USER_ID}:sockets`, SOCKET_A);
      expect(redis.del).toHaveBeenCalledWith(`ws:socket:${SOCKET_A}`);
      expect(event).toBeNull();
      expect(redis.set).not.toHaveBeenCalled();
    });

    it('emits offline when the last socket goes away and stores lastSeen', async () => {
      redis.smembers.mockResolvedValue([]);

      const event = await service.setOffline(USER_ID, SOCKET_A);

      expect(event).toMatchObject({ userId: USER_ID, status: 'offline' });
      expect(typeof event?.lastSeen).toBe('string');
      expect(redis.del).toHaveBeenCalledWith(`ws:user:${USER_ID}:sockets`);
      expect(redis.set).toHaveBeenCalledWith(`ws:user:${USER_ID}:lastSeen`, expect.any(String));
    });
  });

  describe('getPresence', () => {
    it('reports online with no lastSeen', async () => {
      redis.smembers.mockResolvedValue([SOCKET_A]);
      redis.pipeline.mockReturnValue(makePipeline([[null, 1]]));
      redis.get.mockResolvedValue(null);

      await expect(service.getPresence(USER_ID)).resolves.toEqual({
        userId: USER_ID,
        status: 'online',
        lastSeen: null,
      });
    });

    it('reports offline with the stored lastSeen', async () => {
      redis.smembers.mockResolvedValue([]);
      redis.get.mockResolvedValue('2026-10-26T00:00:00.000Z');

      await expect(service.getPresence(USER_ID)).resolves.toEqual({
        userId: USER_ID,
        status: 'offline',
        lastSeen: '2026-10-26T00:00:00.000Z',
      });
    });
  });

  describe('getSocketIds', () => {
    it('returns the live sockets', async () => {
      redis.smembers.mockResolvedValue([SOCKET_A]);
      redis.pipeline.mockReturnValue(makePipeline([[null, 1]]));

      await expect(service.getSocketIds(USER_ID)).resolves.toEqual([SOCKET_A]);
    });

    it('prunes expired sockets before returning the survivors', async () => {
      redis.smembers.mockResolvedValueOnce([SOCKET_A, SOCKET_B]).mockResolvedValueOnce([SOCKET_B]);
      redis.pipeline.mockReturnValue(
        makePipeline([
          [null, 0],
          [null, 1],
        ]),
      );

      await expect(service.getSocketIds(USER_ID)).resolves.toEqual([SOCKET_B]);
      expect(redis.srem).toHaveBeenCalledWith(`ws:user:${USER_ID}:sockets`, SOCKET_A);
    });
  });

  describe('refresh', () => {
    it('extends the TTL of every given socket', async () => {
      const pipeline = makePipeline([]);
      redis.pipeline.mockReturnValue(pipeline);

      await service.refresh([SOCKET_A, SOCKET_B]);

      expect(pipeline.expire).toHaveBeenCalledTimes(2);
      expect(pipeline.expire).toHaveBeenCalledWith(`ws:socket:${SOCKET_A}`, 60);
      expect(pipeline.expire).toHaveBeenCalledWith(`ws:socket:${SOCKET_B}`, 60);
      expect(pipeline.exec).toHaveBeenCalledOnce();
    });

    it('does nothing without sockets', async () => {
      await service.refresh([]);

      expect(redis.pipeline).not.toHaveBeenCalled();
    });
  });
});
