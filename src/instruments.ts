import * as Sentry from "@sentry/nestjs";

Sentry.init({
  dsn: process.env.SENTRY_DSN,
  enabled: process.env.NODE_ENV === "production",
  tracesSampleRate: 1.0,
  includeServerName: true,
  serverName: "omni-backend",
  sendDefaultPii: true,
});
