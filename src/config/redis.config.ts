import { registerAs } from "@nestjs/config";

export type RedisConfig = {
  host: string;
  port: number;
  username: string;
  password?: string;
  keyPrefix?: string;
};

export const RedisConfiguration = registerAs("redis", (): RedisConfig => ({
  host: process.env.REDIS_HOST ?? "127.0.0.1",
  port: parseInt(process.env.REDIS_PORT ?? "6379", 10),
  username: process.env.REDIS_USERNAME || "default",
  password: process.env.REDIS_PASSWORD || undefined,
  keyPrefix: process.env.REDIS_KEY_PREFIX || undefined,
}));
