import { registerAs } from "@nestjs/config";

export type LoggerConfig = {
  httpLogging: {
    enabled: boolean;
  };
};

export const LoggerConfiguration = registerAs("logger", (): LoggerConfig => {
  const httpLoggingEnabled =
    process.env.HTTP_LOGGING_ENABLED?.toLowerCase() === "true" ||
    process.env.HTTP_LOGGING_ENABLED === "1";

  return {
    httpLogging: {
      enabled: httpLoggingEnabled ?? true,
    },
  } satisfies LoggerConfig;
});
