import { Global, Module, Logger } from "@nestjs/common";
import Redis, { RedisOptions } from "ioredis";
import { REDIS_CLIENT } from "./redis.constants";
import { RedisService } from "./redis.service";

@Global()
@Module({
  providers: [
    {
      provide: REDIS_CLIENT,
      useFactory: () => {
        const logger = new Logger("RedisModule");
        const url = process.env.REDIS_URL;

        if (!url) throw new Error("REDIS_URL env var required");

        const options: RedisOptions = {
          lazyConnect: true,
          maxRetriesPerRequest: null,
          keyPrefix: process.env.REDIS_KEY_PREFIX,
          tls: url.startsWith("rediss://") ? {} : undefined,
          retryStrategy: (times) => Math.min(times * 1000, 10000),
          reconnectOnError: () => true,
        };

        const client = new Redis(url, options);

        client.on("connect", () => logger.log("Connected to Redis"));
        client.on("ready", () => logger.log("Redis ready"));
        client.on("error", (e) => logger.error(`Redis error: ${e.message}`));
        client.on("close", () => logger.warn("Redis connection closed"));

        client.connect().catch(() => {});

        return client;
      },
    },
    RedisService,
  ],
  exports: [RedisService, REDIS_CLIENT],
})
export class RedisModule {}
