export type Roles = "PA" | "super-admin";
export enum SocialMediaPlatform {
  X = "X",
  Instagram = "Instagram",
  LinkedIn = "LinkedIn",
  Telegram = "Telegram",
  Email = "Email",
}

export type ConversationState = "open" | "closed" | "archived";
export type MessageDirection = "inbound" | "outbound";
export type MessageStatus = "sent" | "delivered" | "read" | "failed";
export type SenderRole = "owner" | "pa";
export type AccountStatus = "active" | "revoked" | "suspended";
export type UserStatus = "active" | "inactive" | "disabled" | "pending";
