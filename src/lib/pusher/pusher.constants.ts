export const PUSHER_CLIENT = Symbol("PUSHER_CLIENT");

export enum PusherChannel {
  PrivateMessaging = "private-messaging",
}

export enum PusherEvent {
  Inbound = "inbound",
  Outbound = "outbound",
  MessageSent = "message-sent",
  MessageError = "message-error",
  MessageRead = "message-read",
}
