import { MfaConfiguration } from "@app/config/mfa.config";
import {
  Inject,
  Injectable,
  InternalServerErrorException,
  Logger,
} from "@nestjs/common";
import { ConfigType } from "@nestjs/config";
import { randomBytes, createCipheriv, createDecipheriv } from "crypto";
import * as Sentry from "@sentry/nestjs";

@Injectable()
export class UtilsService {
  private readonly logger = new Logger(UtilsService.name);
  constructor(
    @Inject(MfaConfiguration.KEY)
    private readonly mfaConfig: ConfigType<typeof MfaConfiguration>,
  ) {}
  public encryptSessionToken(sessionToken: string): string {
    const iv = randomBytes(12);
    const cipher = createCipheriv(
      "aes-256-gcm",
      this.mfaConfig.encryptionKey,
      iv,
    );
    const encrypted = Buffer.concat([
      cipher.update(sessionToken, "utf8"),
      cipher.final(),
    ]);
    const authTag = cipher.getAuthTag();
    return [
      iv.toString("base64"),
      encrypted.toString("base64"),
      authTag.toString("base64"),
    ].join(".");
  }

  public decryptSessionToken(payload: string): string {
    this.logger.debug("Decrypting session token", payload);
    const parts = payload.split(".");
    if (parts.length !== 3 || parts.some((part) => !part)) {
      this.logger.error("Malformed encrypted session token payload");
      throw new InternalServerErrorException("Failed to decrypt session token");
    }

    const iv = Buffer.from(parts[0]!, "base64");
    const data = Buffer.from(parts[1]!, "base64");
    const authTag = Buffer.from(parts[2]!, "base64");
    try {
      const decipher = createDecipheriv(
        "aes-256-gcm",
        this.mfaConfig.encryptionKey,
        iv,
      );
      decipher.setAuthTag(authTag);
      const decrypted = Buffer.concat([
        decipher.update(data),
        decipher.final(),
      ]);
      this.logger.debug(
        "Decrypted session token successfully",
        decrypted.toString("utf8"),
      );
      return decrypted.toString("utf8");
    } catch (error) {
      this.logger.error("Failed to decrypt session token", error);
      throw new InternalServerErrorException("Failed to decrypt session token");
    }
  }

  public encryptEmailCredentials(credentials: {
    email: string;
    imapPassword: string;
    smtpPassword: string;
    imapHost: string;
    imapPort: number;
    imapSecure: boolean;
    smtpHost?: string;
    smtpPort?: number;
    smtpSecure?: boolean;
  }): string {
    const payload = JSON.stringify(credentials);
    const iv = randomBytes(12);
    const cipher = createCipheriv(
      "aes-256-gcm",
      this.mfaConfig.encryptionKey,
      iv,
    );
    const encrypted = Buffer.concat([
      cipher.update(payload, "utf8"),
      cipher.final(),
    ]);
    const authTag = cipher.getAuthTag();
    return [
      iv.toString("base64"),
      encrypted.toString("base64"),
      authTag.toString("base64"),
    ].join(".");
  }

  public decryptEmailCredentials(payload: string): {
    email: string;
    imapPassword: string;
    smtpPassword: string;
    imapHost: string;
    imapPort: number;
    imapSecure: boolean;
    smtpHost?: string;
    smtpPort?: number;
    smtpSecure?: boolean;
  } {
    const parts = payload.split(".");
    if (parts.length !== 3 || parts.some((part) => !part)) {
      this.logger.error("Malformed encrypted email credentials payload");
      throw new InternalServerErrorException(
        "Failed to decrypt email credentials",
      );
    }
    this.logger.debug("Decrypting email credentials");

    const iv = Buffer.from(parts[0]!, "base64");
    const data = Buffer.from(parts[1]!, "base64");
    const authTag = Buffer.from(parts[2]!, "base64");
    try {
      const decipher = createDecipheriv(
        "aes-256-gcm",
        this.mfaConfig.encryptionKey,
        iv,
      );
      decipher.setAuthTag(authTag);
      const decrypted = Buffer.concat([
        decipher.update(data),
        decipher.final(),
      ]);
      this.logger.debug("Decrypted email credentials successfully");
      return JSON.parse(decrypted.toString("utf8"));
    } catch (error) {
      this.logger.error("Failed to decrypt email credentials", error);
      throw new InternalServerErrorException(
        "Failed to decrypt email credentials",
      );
    }
  }

  public reportError(
    error: string | Error,
    context?: {
      tags?: Record<string, string | number | boolean>;
      extra?: Record<string, unknown>;
      level?: Sentry.SeverityLevel;
    },
  ): void {
    const message = error instanceof Error ? error.message : error;
    const level = context?.level || "error";

    Sentry.captureMessage(message, {
      level,
      tags: context?.tags,
      extra: context?.extra,
    });
  }
}
