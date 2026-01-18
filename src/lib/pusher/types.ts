import { MessageStatus, SocialMediaPlatform } from "@app/types";

export interface PusherWebhookEvent {
  name: string;
  channel: string;
  event: string;
  data: string;
  socket_id?: string;
}

export interface PusherWebhookPayload {
  time_ms: number;
  events: PusherWebhookEvent[];
}

export interface PusherSendMessageEvent {
  platform: SocialMediaPlatform;
  chatId: string;
  message: string;
  userId: string;
  tempId: string;
  fail?: boolean;
  subject?: string;
  html?: string;
  reply?: boolean;
  ccRecipients?: string;
  bccRecipients?: string;
}
export type PusherReadMessageEvent = {
  platform: SocialMediaPlatform;
  chatId: string;
  data: {
    messageId: string;
    status: MessageStatus;
  }[];
};
