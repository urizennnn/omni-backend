import { Global, Module, Logger } from "@nestjs/common";
import { ConfigModule, ConfigType } from "@nestjs/config";
import Redis, { RedisOptions } from "ioredis";
import { RedisConfiguration } from "@app/config/redis.config";
import { REDIS_CLIENT } from "./redis.constants";
import { RedisService } from "./redis.service";

@Global()
@Module({
  imports: [ConfigModule.forFeature(RedisConfiguration)],
  providers: [
    {
      provide: REDIS_CLIENT,
      inject: [RedisConfiguration.KEY],
      useFactory: (config: ConfigType<typeof RedisConfiguration>) => {
        const logger = new Logger("RedisModule");
        let errorLogged = false;
        const options: RedisOptions = {
          host: config.host,
          port: config.port,
          db: config.db,
          lazyConnect: true,
          maxRetriesPerRequest: null,
          showFriendlyErrorStack: false,
          retryStrategy: (times) => {
            const delay = Math.min(times * 1000, 10000);
            if (times === 1 && !errorLogged) {
              logger.warn(
                `Redis unavailable at ${config.host}:${config.port}, retrying in background`,
              );
              errorLogged = true;
            }
            return delay;
          },
          reconnectOnError: () => true,
        };

        if (config.password) {
          options.password = config.password;
        }
        if (config.keyPrefix) {
          options.keyPrefix = config.keyPrefix;
        }

        const client = new Redis(options);

        client.on("connect", () => {
          logger.log(`Connected to Redis at ${config.host}:${config.port}`);
        });

        client.on("ready", () => {
          logger.log("Redis ready to accept commands");
          errorLogged = false;
        });

        client.on("error", () => {
          // Suppress error logs - handled in retryStrategy
        });

        client.on("close", () => {
          logger.warn("Redis connection closed");
        });

        client.on("reconnecting", () => {
          // Silent retry
        });

        client.connect().catch(() => {
          // Silent - retryStrategy will handle logging
        });

        return client;
      },
    },
    RedisService,
  ],
  exports: [RedisService, REDIS_CLIENT],
})
export class RedisModule {}
