export enum QueueName {
  SocialMediaPoll = "social-media-poll",
  Messages = "messages",
  ContactsSync = "contacts-sync",
  ConversationDoctor = "conversation-doctor",
  PusherWebhooks = "pusher-webhooks",
  EmailReconciliation = "email-reconciliation",
}

export enum JobName {
  PollAccount = "poll-account",
  SaveMessage = "save-message",
  SyncContacts = "sync-contacts",
  CheckConversations = "check-conversations",
  ProcessPusherSendMessage = "process-pusher-send-message",
  ProcessPusherReadMessage = "process-pusher-read-message",
  ReconcileEmailAccount = "reconcile-email-account",
}
