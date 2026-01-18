import { registerAs } from "@nestjs/config";

export type RedisConfig = {
  host: string;
  port: number;
  password?: string;
  db: number;
  keyPrefix?: string;
};

export const RedisConfiguration = registerAs(
  "redis",
  (): RedisConfig => ({
    host: process.env.REDIS_HOST ?? "127.0.0.1",
    port: parseInt(process.env.REDIS_PORT ?? "6379", 10),
    password: process.env.REDIS_PASSWORD || undefined,
    db: parseInt(process.env.REDIS_DB ?? "0", 10),
    keyPrefix: process.env.REDIS_KEY_PREFIX || undefined,
  }),
);
