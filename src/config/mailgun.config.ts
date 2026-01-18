import { registerAs } from "@nestjs/config";

export type MailgunConfig = {
  smtpHost: string;
  smtpPort: number;
  smtpUser: string;
  smtpPass: string;
  fromEmail?: string;
  secure?: boolean;
};

export const MailgunConfiguation = registerAs(
  "mailgun",
  () =>
    ({
      smtpHost: process.env.MAILGUN_SMTP_HOST ?? "",
      smtpPort: parseInt(process.env.MAILGUN_SMTP_PORT ?? "587", 10),
      smtpUser: process.env.MAILGUN_SMTP_USER ?? "",
      smtpPass: process.env.MAILGUN_SMTP_PASS ?? "",
      secure:
        (process.env.MAILGUN_SMTP_SECURE ?? "false").toLowerCase() === "true",
      fromEmail: process.env.MAILGUN_FROM_EMAIL,
    }) satisfies MailgunConfig,
);
