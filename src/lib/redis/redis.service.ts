import { Inject, Injectable, Logger, OnModuleDestroy } from "@nestjs/common";
import { REDIS_CLIENT } from "./redis.constants";
import type { RedisClient } from "./redis.module";

@Injectable()
export class RedisService implements OnModuleDestroy {
  private readonly logger = new Logger(RedisService.name);

  constructor(@Inject(REDIS_CLIENT) private readonly client: RedisClient) {}

  async onModuleDestroy(): Promise<void> {
    try {
      await this.client.quit();
    } catch {
      await this.client.disconnect();
    }
  }

  async set(key: string, value: string, ttlSeconds?: number): Promise<void> {
    try {
      if (!this.client.isReady) return;
      if (ttlSeconds && ttlSeconds > 0) {
        await this.client.set(key, value, { EX: ttlSeconds });
      } else {
        await this.client.set(key, value);
      }
    } catch (error) {
      this.logger.warn(`Redis set failed for key ${key}: ${error.message}`);
    }
  }

  async get(key: string): Promise<string | null> {
    try {
      if (!this.client.isReady) return null;
      return await this.client.get(key);
    } catch (error) {
      this.logger.warn(`Redis get failed for key ${key}: ${error.message}`);
      return null;
    }
  }

  async del(...keys: string[]): Promise<number> {
    if (!keys.length) return 0;
    try {
      if (!this.client.isReady) return 0;
      return await this.client.del(keys);
    } catch (error) {
      this.logger.warn(`Redis del failed: ${error.message}`);
      return 0;
    }
  }

  async exists(key: string): Promise<boolean> {
    try {
      if (!this.client.isReady) return false;
      const result = await this.client.exists(key);
      return result === 1;
    } catch (error) {
      this.logger.warn(`Redis exists failed for key ${key}: ${error.message}`);
      return false;
    }
  }

  async expire(key: string, ttlSeconds: number): Promise<boolean> {
    try {
      if (!this.client.isReady) return false;
      return await this.client.expire(key, ttlSeconds);
    } catch (error) {
      this.logger.warn(`Redis expire failed for key ${key}: ${error.message}`);
      return false;
    }
  }

  async ttl(key: string): Promise<number> {
    try {
      if (!this.client.isReady) return -2;
      return await this.client.ttl(key);
    } catch (error) {
      this.logger.warn(`Redis ttl failed for key ${key}: ${error.message}`);
      return -2;
    }
  }

  async incr(key: string, amount = 1): Promise<number> {
    try {
      if (!this.client.isReady) return 0;
      return amount === 1
        ? await this.client.incr(key)
        : await this.client.incrBy(key, amount);
    } catch (error) {
      this.logger.warn(`Redis incr failed for key ${key}: ${error.message}`);
      return 0;
    }
  }

  async decr(key: string, amount = 1): Promise<number> {
    try {
      if (!this.client.isReady) return 0;
      return amount === 1
        ? await this.client.decr(key)
        : await this.client.decrBy(key, amount);
    } catch (error) {
      this.logger.warn(`Redis decr failed for key ${key}: ${error.message}`);
      return 0;
    }
  }

  async keys(pattern: string): Promise<string[]> {
    try {
      if (!this.client.isReady) return [];
      return await this.client.keys(pattern);
    } catch (error) {
      this.logger.warn(`Redis keys failed for pattern ${pattern}: ${error.message}`);
      return [];
    }
  }

  async flushDb(): Promise<string> {
    try {
      if (!this.client.isReady) return "OK";
      return await this.client.flushDb();
    } catch (error) {
      this.logger.warn(`Redis flushdb failed: ${error.message}`);
      return "OK";
    }
  }

  isConnected(): boolean {
    return this.client.isReady;
  }

  getStatus(): string {
    return this.client.isReady ? "ready" : "disconnected";
  }

  getClient(): RedisClient {
    return this.client;
  }
}
