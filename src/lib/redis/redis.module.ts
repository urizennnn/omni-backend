import { Global, Module, Logger } from "@nestjs/common";
import { createClient, RedisClientType } from "redis";
import { REDIS_CLIENT } from "./redis.constants";
import { RedisService } from "./redis.service";

export type RedisClient = RedisClientType;

@Global()
@Module({
  providers: [
    {
      provide: REDIS_CLIENT,
      useFactory: async () => {
        const logger = new Logger("RedisModule");

        const host = process.env.REDIS_HOST;
        const port = process.env.REDIS_PORT;
        if (!host || !port) throw new Error("REDIS_HOST and REDIS_PORT required");

        const client = createClient({
          username: process.env.REDIS_USERNAME || "default",
          password: process.env.REDIS_PASSWORD,
          socket: {
            host,
            port: parseInt(port, 10),
            reconnectStrategy: (retries) => Math.min(retries * 1000, 10000),
          },
        });

        client.on("connect", () => logger.log("Connected to Redis"));
        client.on("ready", () => logger.log("Redis ready"));
        client.on("error", (e) => logger.error(`Redis error: ${e.message}`));
        client.on("end", () => logger.warn("Redis connection closed"));

        await client.connect();
        return client;
      },
    },
    RedisService,
  ],
  exports: [RedisService, REDIS_CLIENT],
})
export class RedisModule {}
