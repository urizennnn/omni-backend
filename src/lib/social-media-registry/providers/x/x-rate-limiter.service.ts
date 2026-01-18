import { Injectable, Logger } from "@nestjs/common";
import { RedisService } from "@app/lib/redis/redis.service";

export enum XRateLimitEndpoint {
  DM_EVENTS = "dm_events",
  SEND_MESSAGE = "send_message",
}

export interface RateLimitCheckResult {
  allowed: boolean;
  reason?: string;
  resetAt?: Date;
  retryAfterMs?: number;
}

export interface RateLimitInfo {
  remaining: number;
  reset: number;
  limit: number;
}

@Injectable()
export class XRateLimiterService {
  private readonly logger = new Logger(XRateLimiterService.name);

  private readonly POLL_15MIN_LIMIT = 15;
  private readonly SEND_15MIN_LIMIT = 15;
  private readonly SEND_24H_USER_LIMIT = 1440;
  private readonly SEND_24H_APP_LIMIT = 1440;

  private readonly WINDOW_15MIN = 15 * 60;
  private readonly WINDOW_24H = 24 * 60 * 60;

  constructor(private readonly redis: RedisService) {}

  async checkPollLimit(userId: string): Promise<RateLimitCheckResult> {
    const key = this.getPollKey(userId);
    const current = await this.getCounter(key);

    if (current >= this.POLL_15MIN_LIMIT) {
      const ttl = await this.redis.ttl(key);
      const resetAt = new Date(Date.now() + ttl * 1000);
      return {
        allowed: false,
        reason: "Poll rate limit exceeded (15/15min)",
        resetAt,
        retryAfterMs: ttl * 1000,
      };
    }

    return { allowed: true };
  }

  async checkSendLimit(userId: string): Promise<RateLimitCheckResult> {
    const key15min = this.getSend15MinKey(userId);
    const key24hUser = this.getSend24HUserKey(userId);
    const key24hApp = this.getSend24HAppKey();

    const [count15min, count24hUser, count24hApp] = await Promise.all([
      this.getCounter(key15min),
      this.getCounter(key24hUser),
      this.getCounter(key24hApp),
    ]);

    if (count15min >= this.SEND_15MIN_LIMIT) {
      const ttl = await this.redis.ttl(key15min);
      return {
        allowed: false,
        reason: "Send rate limit exceeded (15/15min)",
        resetAt: new Date(Date.now() + ttl * 1000),
        retryAfterMs: ttl * 1000,
      };
    }

    if (count24hUser >= this.SEND_24H_USER_LIMIT) {
      const ttl = await this.redis.ttl(key24hUser);
      return {
        allowed: false,
        reason: "Daily user send limit exceeded (1440/24h)",
        resetAt: new Date(Date.now() + ttl * 1000),
        retryAfterMs: ttl * 1000,
      };
    }

    if (count24hApp >= this.SEND_24H_APP_LIMIT) {
      const ttl = await this.redis.ttl(key24hApp);
      return {
        allowed: false,
        reason: "Daily app-wide send limit exceeded (1440/24h)",
        resetAt: new Date(Date.now() + ttl * 1000),
        retryAfterMs: ttl * 1000,
      };
    }

    return { allowed: true };
  }

  async incrementPollCounter(userId: string): Promise<void> {
    const key = this.getPollKey(userId);
    const current = await this.getCounter(key);

    if (current === 0) {
      await this.redis.set(key, "1", this.WINDOW_15MIN);
    } else {
      await this.redis.incr(key);
    }
  }

  async incrementSendCounter(userId: string): Promise<void> {
    const key15min = this.getSend15MinKey(userId);
    const key24hUser = this.getSend24HUserKey(userId);
    const key24hApp = this.getSend24HAppKey();

    await Promise.all([
      this.incrementCounter(key15min, this.WINDOW_15MIN),
      this.incrementCounter(key24hUser, this.WINDOW_24H),
      this.incrementCounter(key24hApp, this.WINDOW_24H),
    ]);
  }

  async storeRateLimitFromHeaders(
    userId: string,
    endpoint: XRateLimitEndpoint,
    headers: Record<string, unknown>,
  ): Promise<void> {
    const currentTime = Math.floor(Date.now() / 1000);

    const resetValue = headers["x-rate-limit-reset"];
    const remainingValue = headers["x-rate-limit-remaining"];

    if (resetValue && remainingValue !== undefined) {
      const resetTimestamp = Number(resetValue);
      const remaining = Number(remainingValue);

      if (!isNaN(resetTimestamp) && !isNaN(remaining)) {
        const ttl = resetTimestamp - currentTime;
        if (ttl > 0) {
          const key = this.getRateLimitInfoKey(userId, endpoint);
          const info: RateLimitInfo = {
            remaining,
            reset: resetTimestamp,
            limit: Number(headers["x-rate-limit-limit"]) || 15,
          };
          await this.redis.set(key, JSON.stringify(info), ttl);
        }
      }
    }

    const user24HourReset = headers["x-user-limit-24hour-reset"];
    const user24HourRemaining = headers["x-user-limit-24hour-remaining"];

    if (user24HourReset && user24HourRemaining !== undefined) {
      const resetTimestamp = Number(user24HourReset);
      const remaining = Number(user24HourRemaining);

      if (!isNaN(resetTimestamp) && !isNaN(remaining)) {
        const ttl = resetTimestamp - currentTime;
        if (ttl > 0) {
          const key = this.get24HourLimitInfoKey(userId);
          const info: RateLimitInfo = {
            remaining,
            reset: resetTimestamp,
            limit: Number(headers["x-user-limit-24hour-limit"]) || 1,
          };
          await this.redis.set(key, JSON.stringify(info), ttl);

          if (remaining === 0) {
            this.logger.warn(
              `User ${userId} exhausted 24-hour limit. Reset at ${new Date(resetTimestamp * 1000).toISOString()}`,
            );
          }
        }
      }
    }
  }

  async getRateLimitInfo(
    userId: string,
    endpoint: XRateLimitEndpoint,
  ): Promise<RateLimitInfo | null> {
    const key = this.getRateLimitInfoKey(userId, endpoint);
    const data = await this.redis.get(key);
    return data ? JSON.parse(data) : null;
  }

  async get24HourLimitInfo(userId: string): Promise<RateLimitInfo | null> {
    const key = this.get24HourLimitInfoKey(userId);
    const data = await this.redis.get(key);
    return data ? JSON.parse(data) : null;
  }

  async getBackoffMs(userId: string): Promise<number | null> {
    const info = await this.get24HourLimitInfo(userId);
    if (!info || info.remaining > 0) {
      return null;
    }

    const currentTime = Math.floor(Date.now() / 1000);
    const backoffSeconds = info.reset - currentTime;
    return backoffSeconds > 0 ? backoffSeconds * 1000 : null;
  }

  async setBackoff(
    userId: string,
    endpoint: XRateLimitEndpoint,
    backoffMs: number,
  ): Promise<void> {
    const key = this.getBackoffKey(userId, endpoint);
    await this.redis.set(
      key,
      backoffMs.toString(),
      Math.ceil(backoffMs / 1000),
    );
  }

  async getBackoff(
    userId: string,
    endpoint: XRateLimitEndpoint,
  ): Promise<number | null> {
    const key = this.getBackoffKey(userId, endpoint);
    const value = await this.redis.get(key);
    return value ? Number(value) : null;
  }

  async clearBackoff(
    userId: string,
    endpoint: XRateLimitEndpoint,
  ): Promise<void> {
    const key = this.getBackoffKey(userId, endpoint);
    await this.redis.del(key);
  }

  async handle429Response(
    userId: string,
    endpoint: XRateLimitEndpoint,
    headers?: Record<string, unknown>,
  ): Promise<void> {
    if (headers) {
      await this.storeRateLimitFromHeaders(userId, endpoint, headers);
    }

    const backoffMs = await this.getBackoffMs(userId);
    if (backoffMs && backoffMs > 0) {
      await this.setBackoff(userId, endpoint, backoffMs);
      this.logger.warn(
        `429 response for user ${userId} on ${endpoint}. Backing off for ${Math.floor(backoffMs / 60000)} minutes`,
      );
    }
  }

  private getPollKey(userId: string): string {
    return `x:poll:15min:${userId}`;
  }

  private getSend15MinKey(userId: string): string {
    return `x:send:15min:${userId}`;
  }

  private getSend24HUserKey(userId: string): string {
    return `x:send:24h:user:${userId}`;
  }

  private getSend24HAppKey(): string {
    return `x:send:24h:app`;
  }

  private getRateLimitInfoKey(
    userId: string,
    endpoint: XRateLimitEndpoint,
  ): string {
    return `x:ratelimit:info:${userId}:${endpoint}`;
  }

  private get24HourLimitInfoKey(userId: string): string {
    return `x:ratelimit:24h:${userId}`;
  }

  private getBackoffKey(userId: string, endpoint: XRateLimitEndpoint): string {
    return `x:backoff:${userId}:${endpoint}`;
  }

  private async getCounter(key: string): Promise<number> {
    const value = await this.redis.get(key);
    return value ? Number(value) : 0;
  }

  private async incrementCounter(key: string, ttl: number): Promise<void> {
    const current = await this.getCounter(key);
    if (current === 0) {
      await this.redis.set(key, "1", ttl);
    } else {
      await this.redis.incr(key);
    }
  }
}
