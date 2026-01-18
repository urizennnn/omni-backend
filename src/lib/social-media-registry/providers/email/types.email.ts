import { ImapFlow } from "imapflow/lib/imap-flow";

export interface EmailConnectionConfig {
  host: string;
  port: number;
  secure: boolean;
  auth: {
    user: string;
    pass: string;
  };
}

export interface ManagedConnection {
  client: ImapFlow;
  accountId: string;
  lastUsed: Date;
  isConnecting: boolean;
  reconnectAttempts: number;
}

export type MailOptions = {
  from: string;
  to: string;
  cc?: string;
  bcc?: string;
  subject: string;
  text: string;
  html?: string;
  headers?: {
    "In-Reply-To"?: string;
    References?: string;
  };
};
export interface EmailPollCursor extends Record<string, unknown> {
  Inbox: number;
  Sent: number;
}

export interface EmailCredentials {
  email: string;
  imapPassword: string;
  smtpPassword: string;
  imapHost: string;
  imapPort: number;
  imapSecure: boolean;
  smtpHost?: string;
  smtpPort?: number;
  smtpSecure?: boolean;
}

export enum EmailFolder {
  Inbox = "INBOX",
  Sent = "Sent",
}
