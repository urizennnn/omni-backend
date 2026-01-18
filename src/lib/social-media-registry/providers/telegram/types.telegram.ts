export type TelegramMessageList = TelegramMessage[];

export interface TelegramMessage {
  externalMessageId: string;
  conversationExternalId: string;
  sentAt: string;
  senderHandle: string;
  text: string;
  raw: RawMessage;
}

export interface RawMessage {
  id: number;
  date: number;
  message: string;
  out: boolean;
  mentioned: boolean;
  mediaUnread: boolean;
  silent: boolean;
  post: boolean;
  fromScheduled: boolean;
  legacy: boolean;
  editHide: boolean;
  pinned: boolean;
  noforwards: boolean;
  invertMedia: boolean;
  offline: boolean;
  videoProcessingPending: boolean;
  flags: number;
  flags2: number;
  fromId: PeerUser | null;
  fromBoostsApplied: unknown;
  peerId: PeerUser;
  savedPeerId?: PeerUser | null;
  fwdFrom: unknown;
  viaBotId: unknown;
  viaBusinessBotId: unknown;
  replyTo: unknown;
  media: RawMedia | null;
  replyMarkup: unknown;
  entities?: RawEntity[] | null;
  views: unknown;
  forwards: unknown;
  replies: unknown;
  editDate: number | null;
  postAuthor: string | null;
  groupedId: unknown;
  reactions: unknown;
  restrictionReason: unknown;
  ttlPeriod: unknown;
  quickReplyShortcutId: unknown;
  effect: unknown;
  factcheck: unknown;
  reportDeliveryUntilDate: unknown;
  className: "Message";
  [k: string]: unknown;
}

export interface PeerUser {
  userId: string;
  className: "PeerUser";
}

export type RawEntity =
  | { className: "MessageEntityUrl"; offset: number; length: number }
  | { className: string; [k: string]: unknown };

export type RawMedia = MessageMediaWebPage | MessageMediaDocument;

export interface MessageMediaWebPage {
  className: "MessageMediaWebPage";
  webpage: WebPage;
  [k: string]: unknown;
}

export interface WebPage {
  className: "WebPage";
  id: string;
  url: string;
  displayUrl?: string;
  type?: string;
  siteName?: string;
  title?: string;
  description?: string;
  hasLargeMedia?: boolean;
  photo?: Photo | null;
  duration?: number | null;
  [k: string]: unknown;
}

export interface Photo {
  className: "Photo";
  id: string;
  accessHash?: string;
  fileReference?: BufferLike;
  date?: number;
  sizes?: Array<PhotoSize | PhotoStrippedSize | PhotoSizeProgressive>;
  videoSizes?: unknown;
  dcId?: number;
  [k: string]: unknown;
}

export interface PhotoSize {
  className: "PhotoSize";
  type: string;
  w: number;
  h: number;
  size: number;
}

export interface PhotoStrippedSize {
  className: "PhotoStrippedSize";
  type: string;
  bytes: BufferLike;
}

export interface PhotoSizeProgressive {
  className: "PhotoSizeProgressive";
  type: string;
  w: number;
  h: number;
  sizes: number[];
}

export type BufferLike = { type: "Buffer"; data: number[] };

export interface MessageMediaDocument {
  className: "MessageMediaDocument";
  document: TelegramDocument;
  [k: string]: unknown;
}

export interface TelegramDocument {
  className: "Document";
  id: string;
  accessHash?: string;
  fileReference?: BufferLike;
  mimeType?: string;
  size?: string | number;
  thumbs?: Array<PhotoSize | PhotoStrippedSize>;
  attributes?: DocumentAttribute[];
  date?: number;
  dcId?: number;
  [k: string]: unknown;
}

export type DocumentAttribute =
  | { className: "DocumentAttributeFilename"; fileName: string }
  | { className: string; [k: string]: unknown };

export interface TdlFormattedText {
  _: "formattedText";
  text: string;
  entities: unknown[];
}

export interface TdlMessageContent {
  _: "messageText" | string;
  text?: TdlFormattedText;
}

export interface TdlMessage {
  _: "message";
  id: number;
  sender_id?: {
    _: "messageSenderUser";
    user_id: number;
  };
  chat_id: number;
  is_outgoing: boolean;
  is_pinned: boolean;
  is_from_offline: boolean;
  can_be_saved: boolean;
  has_timestamped_media: boolean;
  is_channel_post: boolean;
  contains_unread_mention: boolean;
  date: number;
  edit_date: number;
  content: TdlMessageContent;
}

export interface TdlUpdateNewMessage {
  _: "updateNewMessage";
  message: TdlMessage;
}

export interface TdlUpdateMessageContent {
  _: "updateMessageContent";
  chat_id: number;
  message_id: number;
  new_content: TdlMessageContent;
}

export interface TdlUpdateDeleteMessages {
  _: "updateDeleteMessages";
  chat_id: number;
  message_ids: number[];
  is_permanent: boolean;
  from_cache: boolean;
}

export interface TdlUpdateChatReadInbox {
  _: "updateChatReadInbox";
  chat_id: number;
  last_read_inbox_message_id: number;
  unread_count: number;
}

export interface TdlUpdateChatReadOutbox {
  _: "updateChatReadOutbox";
  chat_id: number;
  last_read_outbox_message_id: number;
}

export interface TdlUserStatus {
  _:
    | "userStatusOnline"
    | "userStatusOffline"
    | "userStatusRecently"
    | "userStatusLastWeek"
    | "userStatusLastMonth";
  expires?: number;
  was_online?: number;
}

export interface TdlUpdateUserStatus {
  _: "updateUserStatus";
  user_id: number;
  status: TdlUserStatus;
}

export interface TdlChat {
  id: number;
  title?: string;
  unread_count?: number;
}

export interface TdlUpdateNewChat {
  _: "updateNewChat";
  chat: TdlChat;
}

export interface TdlUpdateChatLastMessage {
  _: "updateChatLastMessage";
  chat_id: number;
  last_message: TdlMessage;
  positions: unknown[];
}

export interface TdlUpdateMessageSendSucceeded {
  _: "updateMessageSendSucceeded";
  message: TdlMessage;
  old_message_id: number;
}

export type TdlUpdate =
  | TdlUpdateNewMessage
  | TdlUpdateMessageContent
  | TdlUpdateDeleteMessages
  | TdlUpdateChatReadInbox
  | TdlUpdateChatReadOutbox
  | TdlUpdateUserStatus
  | TdlUpdateNewChat
  | TdlUpdateChatLastMessage
  | TdlUpdateMessageSendSucceeded
  | { _: "updateAuthorizationState" | string; [key: string]: unknown };
