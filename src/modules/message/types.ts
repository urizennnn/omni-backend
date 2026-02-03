import { MessageEntity } from "@app/entities/messages.entity";
import {
  ConversationState,
  MessageStatus,
  SocialMediaPlatform,
} from "@app/types";

export interface FetchConversationsQuery {
  platform?: SocialMediaPlatform;
  cursor?: string;
  limit?: number;
}

export interface FetchMessagesQuery {
  conversationId: string;
  threadId?: string;
  cursor?: string;
  limit?: number;
}

export interface PaginatedMessagesResponse {
  data: any[];
  nextCursor: string | null;
  hasMore: boolean;
}

export interface FetchAllConversationsQuery {
  cursor?: string;
  limit?: number;
}

export interface AllConversationsResponse {
  data: ConversationListItem[];
  nextCursor: string | null;
  hasMore: boolean;
  platformCounts: Record<string, number>;
}

export interface WipeEmailInboxBody {
  accountId: string;
  folderPath?: string;
}
export interface ConversationListItem {
  id: string;
  externalId: string;
  platform: SocialMediaPlatform;
  accountId: string;
  name: string;
  unreadCount: number;
  state?: ConversationState;
  text?: string;
  online?: boolean;
  lastSeen?: Date;
  createdAt: Date;
  updatedAt: Date;
  lastMessageStatus?: MessageStatus;
  conversationType?: "parent" | "child";
  receiverEmail?: string;
  children?: ConversationListItem[];
  parentConversationId?: string;
  subject?: string;
  out?: boolean;
  sentAt?: Date;
  direction?: string;
  messageStatus?: string;
  role?: string;
  sentBy?: Partial<UserDTO>;
  provideOriginalPayload?: object;
  externalMessageId?: string;
  threadId?: string;
  messageId?: string;
  inReplyTo?: string;
  references?: string[];
  participants?: string[];
  bccRecipients?: string[];
}

export interface RoleDTO {
  id: string;
  name: string;
  createdAt: Date;
  updatedAt: Date;
}

export interface UserDTO {
  id: string;
  email: string;
  firstName: string;
  lastName: string;
  status: string;
  createdAt: Date;
  updatedAt: Date;
  role: RoleDTO;
  platformAccess: any[];
  phoneNumber?: string;
  disabled?: boolean;
  emailVerifiedAt?: Date;
  twoFactorSecret?: string;
}

export interface ConversationDTO {
  id: string;
  externalId: string;
  platform: SocialMediaPlatform;
  accountId: string;
  name: string;
  unreadCount: number;
  state: ConversationState;
  online?: boolean;
  createdAt: Date;
  updatedAt: Date;
  user: UserDTO;
  text?: string;
  lastSeen?: Date;
  lastMessageStatus?: string;
  platformData?: Record<string, unknown>;
  conversationType?: string;
  receiverEmail?: string;
  participants?: string[];
  bccRecipients?: string[];
}

export interface ThreadedMessageDTO {
  id: string;
  conversationId: ConversationDTO;
  externalMessageId: string;
  direction: string;
  status: string;
  role: string;
  provideOriginalPayload: object;
  createdAt: Date;
  updatedAt: Date;
  text?: string;
  subject?: string;
  out?: boolean;
  sentAt?: Date;
  messageId?: string;
  inReplyTo?: string;
  references?: string[];
  threadId?: string;
  sentBy?: UserDTO;
  children?: ThreadedMessageDTO[];
  participants?: string[];
  externalSenderEmail?: string;
  externalSenderName?: string;
}

export interface WipeEmailInboxParams {
  accountId: string;
  folderPath?: string;
}
export interface ThreadedMessage extends MessageEntity {
  children?: ThreadedMessage[];
}
