import { registerAs } from "@nestjs/config";

export type RedisConfig = {
  url?: string;
  host: string;
  port: number;
  password?: string;
  db: number;
  keyPrefix?: string;
  tls: boolean;
};

export const RedisConfiguration = registerAs("redis", (): RedisConfig => {
  const url = process.env.REDIS_URL;
  return {
    url,
    host: process.env.REDIS_HOST ?? "127.0.0.1",
    port: parseInt(process.env.REDIS_PORT ?? "6379", 10),
    password: process.env.REDIS_PASSWORD || undefined,
    db: parseInt(process.env.REDIS_DB ?? "0", 10),
    keyPrefix: process.env.REDIS_KEY_PREFIX || undefined,
    tls: url?.startsWith("rediss://") ?? false,
  };
});
