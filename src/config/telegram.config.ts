import { registerAs } from "@nestjs/config";

type TelegramConfig = {
  apiId: string;
  apiHash: string;
  connectionRetries: number;
  reconnectRetries: number;
  retryDelayMs: number;
  timeoutSeconds: number;
};

const parseNumeric = (
  raw: string | undefined,
  fallback: number,
  options?: { allowZero?: boolean },
) => {
  const parsed = Number.parseInt(raw ?? "", 10);
  if (!Number.isFinite(parsed)) return fallback;
  if (!options?.allowZero && parsed <= 0) return fallback;
  if (options?.allowZero && parsed < 0) return fallback;
  return parsed;
};

export const TelegramConfiguration = registerAs(
  "telegram",
  (): TelegramConfig => {
    return {
      apiId: process.env.TELEGRAM_API_ID ?? "",
      apiHash: process.env.TELEGRAM_API_HASH ?? "",
      connectionRetries: parseNumeric(
        process.env.TELEGRAM_CONNECTION_RETRIES,
        2,
        { allowZero: true },
      ),
      reconnectRetries: parseNumeric(
        process.env.TELEGRAM_RECONNECT_RETRIES,
        3,
        { allowZero: true },
      ),
      retryDelayMs: parseNumeric(process.env.TELEGRAM_RETRY_DELAY_MS, 1000, {
        allowZero: true,
      }),
      timeoutSeconds: parseNumeric(process.env.TELEGRAM_TIMEOUT_SECONDS, 30, {
        allowZero: false,
      }),
    } satisfies TelegramConfig;
  },
);
