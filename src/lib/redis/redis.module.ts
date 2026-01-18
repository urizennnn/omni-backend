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

        const baseOptions: RedisOptions = {
          lazyConnect: true,
          maxRetriesPerRequest: null,
          showFriendlyErrorStack: false,
          retryStrategy: (times) => {
            const delay = Math.min(times * 1000, 10000);
            if (times === 1 && !errorLogged) {
              logger.warn("Redis unavailable, retrying in background");
              errorLogged = true;
            }
            return delay;
          },
          reconnectOnError: () => true,
        };

        if (config.keyPrefix) baseOptions.keyPrefix = config.keyPrefix;
        if (config.tls) baseOptions.tls = {};

        const client = config.url
          ? new Redis(config.url, baseOptions)
          : new Redis({ ...baseOptions, host: config.host, port: config.port, db: config.db, password: config.password });

        client.on("connect", () => logger.log("Connected to Redis"));
        client.on("ready", () => {
          logger.log("Redis ready");
          errorLogged = false;
        });
        client.on("error", () => {});
        client.on("close", () => logger.warn("Redis connection closed"));
        client.on("reconnecting", () => {});

        client.connect().catch(() => {});

        return client;
      },
    },
    RedisService,
  ],
  exports: [RedisService, REDIS_CLIENT],
})
export class RedisModule {}
