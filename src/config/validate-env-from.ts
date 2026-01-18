import { z } from "zod";
export enum Envrionment {
  Development = "development",
  Test = "test",
  Production = "production",
}
const schema = z.object({
  NODE_ENV: z
    .enum([Envrionment.Development, Envrionment.Test, Envrionment.Production])
    .default(Envrionment.Development),
  PORT: z.coerce.number().int().positive().default(3000),
  LOG_LEVEL: z.string().default("debug"),

  API_BASE_URL: z.string().url().optional(),

  DATABASE_URL: z.string().min(1, "DATABASE_URL is required"),
  DB_NAME: z.string().min(1, "DB_NAME is required"),

  REDIS_HOST: z.string().min(1, "REDIS_HOST is required"),
  REDIS_PORT: z.coerce.number().int().positive().default(6379),
  REDIS_PASSWORD: z.string().optional(),
  REDIS_DB: z.coerce.number().int().nonnegative().default(0),
  REDIS_KEY_PREFIX: z.string().optional(),

  MAILGUN_SMTP_HOST: z.string().min(1, "MAILGUN_SMTP_HOST is required"),
  MAILGUN_SMTP_PORT: z.coerce.number().int().positive().default(587),
  MAILGUN_SMTP_USER: z.string().min(1, "MAILGUN_SMTP_USER is required"),
  MAILGUN_SMTP_PASS: z.string().min(1, "MAILGUN_SMTP_PASS is required"),
  MAILGUN_SMTP_SECURE: z.enum(["true", "false"]).optional().default("false"),
  MAILGUN_FROM_EMAIL: z.string().email().optional(),
  SUPERADMIN_EMAIL: z.string().email().min(1, "SUPERADMIN_EMAIL is required"),
  SUPERADMIN_FIRSTNAME: z.string().min(1, "SUPERADMIN_FIRSTNAME is required"),
  SUPERADMIN_LASTNAME: z.string().min(1, "SUPERADMIN_LASTNAME is required"),
  SUPERADMIN_PHONE: z.string().min(1, "SUPERADMIN_PHONE is required"),

  TELEGRAM_API_ID: z.string().min(1, "TELEGRAM_API_ID is required"),
  TELEGRAM_API_HASH: z.string().min(1, "TELEGRAM_API_HASH is required"),
  TELEGRAM_CONNECTION_RETRIES: z.coerce
    .number()
    .int()
    .nonnegative()
    .optional()
    .default(2),
  TELEGRAM_RECONNECT_RETRIES: z.coerce
    .number()
    .int()
    .nonnegative()
    .optional()
    .default(3),
  TELEGRAM_RETRY_DELAY_MS: z.coerce
    .number()
    .int()
    .nonnegative()
    .optional()
    .default(1000),
  TELEGRAM_TIMEOUT_SECONDS: z.coerce
    .number()
    .int()
    .positive()
    .optional()
    .default(30),

  X_API_KEY: z.string().optional().default(""),
  X_API_SECRET: z.string().optional().default(""),
  X_API_BEARER_TOKEN: z.string().optional().default(""),
  X_API_ACCESS_TOKEN: z.string().optional().default(""),
  X_API_ACCESS_TOKEN_SECRET: z.string().optional().default(""),
  X_OAUTH_CLIENT_ID: z.string().optional().default(""),
  X_OAUTH_CLIENT_SECRET: z.string().optional().default(""),
  X_OAUTH_REDIRECT_URI: z
    .string()
    .optional()
    .default("http://localhost:3000/api/v1/auth/x/callback"),
  X_OAUTH_SCOPES: z
    .string()
    .optional()
    .default("tweet.read users.read dm.read dm.write offline.access"),

  JWT_SECRET: z.string().min(1, "JWT_SECRET is required"),
  JWT_EXPIRES_IN: z.string().default("1h"),
  JWT_REFRESH_SECRET: z.string().optional(),
  JWT_REFRESH_EXPIRES_IN: z.string().default("7d"),
  MFA_SECRET_KEY: z.string().min(1, "MFA_SECRET_KEY is required"),

  SENTRY_DSN: z.string().url().optional(),
});
// .strict({ message: "Unknown environment variable(s) present" });

export type AppEnv = z.infer<typeof schema>;

export function validateEnvFrom(env: Record<string, unknown>): AppEnv {
  const normalized = { ...env };
  const parsed = schema.safeParse(normalized);
  if (!parsed.success) {
    const issues = parsed.error.issues
      .map((i) => `${i.path.join(".")}: ${i.message}`)
      .join("; ");
    throw new Error(`Invalid environment configuration: ${issues}`);
  }
  return parsed.data;
}
