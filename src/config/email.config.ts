import { registerAs } from "@nestjs/config";

export const EmailConfiguration = registerAs("email", () => {
  return {
    imap: {
      defaultPort: parseInt(process.env.EMAIL_IMAP_PORT || "993", 10),
      defaultSecure: process.env.EMAIL_IMAP_SECURE !== "false",
      connectionTimeout: parseInt(
        process.env.EMAIL_IMAP_TIMEOUT_MS || "30000",
        10,
      ),
      maxReconnectAttempts: parseInt(
        process.env.EMAIL_IMAP_MAX_RECONNECT || "5",
        10,
      ),
      reconnectDelayMs: parseInt(
        process.env.EMAIL_IMAP_RECONNECT_DELAY_MS || "2000",
        10,
      ),
      idleMaxIdleTime: parseInt(
        process.env.EMAIL_IMAP_IDLE_MAX_TIME_MS || "300000",
        10,
      ),
    },
    smtp: {
      defaultPort: parseInt(process.env.EMAIL_SMTP_PORT || "587", 10),
      defaultSecure: process.env.EMAIL_SMTP_SECURE === "true",
      connectionTimeout: parseInt(
        process.env.EMAIL_SMTP_TIMEOUT_MS || "30000",
        10,
      ),
    },
    polling: {
      intervalSeconds: parseInt(
        process.env.EMAIL_POLLING_INTERVAL_SECONDS || "60",
        10,
      ),
      batchSize: parseInt(process.env.EMAIL_POLLING_BATCH_SIZE || "50", 10),
    },
    messageRetrieval: {
      maxMessagesPerPoll: parseInt(
        process.env.EMAIL_MAX_MESSAGES_PER_POLL || "100",
        10,
      ),
      includeAttachments: process.env.EMAIL_INCLUDE_ATTACHMENTS !== "false",
      maxAttachmentSizeMb: parseInt(
        process.env.EMAIL_MAX_ATTACHMENT_SIZE_MB || "25",
        10,
      ),
    },
    reconciliation: {
      intervalMs: parseInt(
        process.env.EMAIL_RECONCILIATION_INTERVAL_MS || "300000",
        10,
      ),
      remoteWindowSize: parseInt(
        process.env.EMAIL_RECONCILIATION_REMOTE_WINDOW || "500",
        10,
      ),
      localLookback: parseInt(
        process.env.EMAIL_RECONCILIATION_LOCAL_LOOKBACK || "750",
        10,
      ),
    },
  } as const;
});
