import { MailgunConfiguation, MailgunConfig } from "@app/config/mailgun.config";
import { UserEntity } from "@app/entities/user.entity";
import { Inject, Injectable, Logger } from "@nestjs/common";
import { ConfigType } from "@nestjs/config";
import * as nodemailer from "nodemailer";
import type { Transporter } from "nodemailer";

const DEFAULT_FROM_EMAIL = "Sir Mapy Tools <no-reply@sirmapy.net>";

export interface MailgunMessageData {
  to: string | string[];
  from: string;
  subject: string;
  text?: string;
  html?: string;
}

export interface MailgunClient {
  messages: {
    create: (domain: string, data: MailgunMessageData) => Promise<unknown>;
  };
}

export interface MailgunClientBundle {
  client: MailgunClient;
  domain: string;
  fromEmail: string;
}

@Injectable()
export class MailgunEmailFactory {
  private readonly logger = new Logger(MailgunEmailFactory.name);

  private clientBundle?: MailgunClientBundle;
  private transporter?: Transporter;

  constructor(
    @Inject(MailgunConfiguation.KEY)
    private configService: ConfigType<typeof MailgunConfiguation>,
  ) {}

  private getClient(): MailgunClientBundle | null {
    if (this.clientBundle) {
      return this.clientBundle;
    }

    const config = this.configService as MailgunConfig;

    if (
      !config?.smtpHost ||
      !config?.smtpPort ||
      !config?.smtpUser ||
      !config?.smtpPass
    ) {
      this.logger.warn(
        "SMTP configuration is missing; email client not initialized.",
      );
      return null;
    }

    const sender = config.fromEmail?.trim() ?? "";
    const fromEmail = sender.length > 0 ? sender : DEFAULT_FROM_EMAIL;

    if (!sender.length) {
      this.logger.warn(
        `Mailgun from email address not configured; defaulting to '${DEFAULT_FROM_EMAIL}'.`,
      );
    }

    const transporter: Transporter = nodemailer.createTransport({
      host: config.smtpHost,
      port: config.smtpPort,
      secure: Boolean(config.secure),
      auth: {
        user: config.smtpUser,
        pass: config.smtpPass,
      },
    });
    this.transporter = transporter;

    const client: MailgunClient = {
      messages: {
        create: async (_domain: string, data: MailgunMessageData) => {
          await transporter.sendMail({
            to: data.to,
            from: data.from,
            subject: data.subject,
            text: data.text,
            html: data.html,
          });
          return { status: "sent" };
        },
      },
    };

    this.clientBundle = {
      client,
      domain: "",
      fromEmail,
    };

    return this.clientBundle;
  }

  public composeInviteEmail(user: UserEntity): {
    subject: string;
    text: string;
    html: string;
  } {
    const subject = "You have been invited";
    const text = `Hello ${user.firstName},\n\nYou have been invited as PA. Complete your setup to get started.\n`;
    const html = `<p>Hello ${user.firstName},</p><p>You have been invited as <b>PA</b>. Complete your setup to get started.</p>`;
    return { subject, text, html };
  }

  public composeOtpEmail(otp: string): {
    subject: string;
    text: string;
    html: string;
  } {
    const subject = "Your verification code";
    const text = `Use the verification code ${otp}. It expires in 10 minutes.`;
    const html = `<p>Use the verification code <strong>${otp}</strong>. It expires in 10 minutes.</p>`;
    return { subject, text, html };
  }
  async sendMail(params: {
    to: string | string[];
    subject: string;
    text?: string;
    html?: string;
    fromEmail?: string;
  }): Promise<void> {
    try {
      const bundle = this.getClient();
      if (!bundle || !this.transporter) {
        this.logger.warn(
          "SMTP transporter unavailable; cannot send email at this time.",
        );
        throw new Error("SMTP transporter unavailable");
      }

      this.logger.log(
        `Sending email to ${params.to} with subject '${params.subject}'`,
      );
      const from = `Sir Mapy Tools <${bundle.fromEmail}>`;

      await this.transporter.sendMail({
        to: params.to,
        from,
        subject: params.subject,
        text: params.text,
        html: params.html,
      });
      this.logger.log(`Email sent to ${params.to}`);
    } catch (error) {
      this.logger.error(
        "Unable to send email",
        error instanceof Error ? error.stack : String(error),
      );
    }
  }
}
