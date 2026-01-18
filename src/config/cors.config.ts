import { registerAs } from "@nestjs/config";

export type CorsConfig = {
  enabled: boolean;
  origin: boolean | (string | RegExp)[];
  credentials?: boolean;
  methods?: string[];
};

export const CorsConfiguration = registerAs("cors", (): CorsConfig => {
  const nodeEnv = (process.env.NODE_ENV || "development").toLowerCase();

  if (nodeEnv === "production") {
    return {
      enabled: true,
      origin: [
        /^https?:\/\/(?:[a-z0-9-]+\.)*omni\.sirmapy\.net(?::\d+)?$/i,
        "https://omni-frontend-aw0z.onrender.com",
      ],
      credentials: true,
      methods: ["GET", "HEAD", "PUT", "PATCH", "POST", "DELETE", "OPTIONS"],
    } satisfies CorsConfig;
  }

  if (nodeEnv === "development") {
    return {
      enabled: true,
      origin: [
        /^https?:\/\/localhost(?::\d+)?$/i,
        /^https?:\/\/127\.0\.0\.1(?::\d+)?$/,
        /^https?:\/\/(?:[a-z0-9-]+\.)*omni\.sirmapy\.net(?::\d+)?$/i,
      ],
      credentials: true,
      methods: ["GET", "HEAD", "PUT", "PATCH", "POST", "DELETE", "OPTIONS"],
    } satisfies CorsConfig;
  }

  return {
    enabled: true,
    origin: [
      /^http?:\/\/localhost(?::\d+)?$/i,
      /^http?:\/\/127\.0\.0\.1(?::\d+)?$/,
    ],
    credentials: true,
    methods: ["GET", "HEAD", "PUT", "PATCH", "POST", "DELETE", "OPTIONS"],
  } satisfies CorsConfig;
});
