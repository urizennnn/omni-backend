import { SocialMediaPlatform } from "@app/types";

export type PollCursor = Record<string, unknown> | null;
export type PollResult = {
  messages: Array<
    | {
        externalMessageId: string;
        conversationExternalId?: string;
        sentAt?: string;
        senderHandle?: string;
        text?: string;
        html?: string;
        attachments?: Array<{
          kind: string;
          url: string;
          mime?: string;
          size?: number;
          durationMs?: number;
        }>;
        raw: unknown;
        messageId?: string;
        inReplyTo?: string;
        references?: string[];
        threadId?: string;
        subject?: string;
      }
    | never
  >;
  nextCursor: PollCursor;
  platform?: SocialMediaPlatform;
  backoffMs?: number;
};

export type SendMessageParams = {
  sessionToken: string;
  chatId: string;
  message: string;
  userId?: string;
  accountId?: string;
  senderRole?: "owner" | "pa";
  fail?: boolean;
  subject?: string;
  html?: string;
  reply?: boolean;
  parentMessageId?: string;
  parentReferences?: string[];
  ccRecipients?: string;
  bccRecipients?: string;
};

export type SendMessageResult = {
  success: boolean;
  messageId?: string;
  error?: string;
  subject?: string;
};

export interface ProviderDriver {
  readonly key: SocialMediaPlatform;
  validateCredentials(token: string, extra?: unknown): Promise<void>;
  poll(account: {
    id: string;
    accessToken: string;
    cursor: PollCursor;
  }): Promise<PollResult>;
  sendMessage(params: SendMessageParams): Promise<SendMessageResult>;
  updateMessageStatus(params: unknown): Promise<boolean>;
}
