import {
  Injectable,
  Logger,
  OnModuleInit,
  OnModuleDestroy,
  Inject,
  forwardRef,
} from "@nestjs/common";
import { InjectRepository } from "@mikro-orm/nestjs";
import {
  EntityManager,
  EntityRepository,
  UniqueConstraintViolationException,
} from "@mikro-orm/core";
import { ConnectedAccountsEntity } from "@app/entities/connected-accounts.entity";
import { ContactEntity } from "@app/entities/contact.entity";
import { MessageEntity } from "@app/entities/messages.entity";
import { ConversationEntity } from "@app/entities/conversation.entity";
import { UserEntity } from "@app/entities/user.entity";
import { SocialMediaPlatform, SenderRole } from "@app/types";
import { TelegramProvider } from "./telegram.provider";
import { PusherService } from "@app/lib/pusher/pusher.service";
import { PusherChannel, PusherEvent } from "@app/lib/pusher/pusher.constants";
import { Client } from "tdl";
import { TelegramConfiguration } from "@app/config/telegram.config";
import { ConfigType } from "@nestjs/config";
import {
  TdlUpdate,
  TdlUpdateNewMessage,
  TdlUpdateMessageContent,
  TdlUpdateDeleteMessages,
  TdlUpdateChatReadInbox,
  TdlUpdateChatReadOutbox,
  TdlUpdateUserStatus,
  TdlUpdateNewChat,
  TdlUpdateMessageSendSucceeded,
  TdlMessage,
} from "./types.telegram";

@Injectable()
export class TelegramEventListener implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(TelegramEventListener.name);
  private monitorInterval: NodeJS.Timeout | null = null;
  private readonly setupClients = new Set<string>();
  private readonly processedUpdates = new Map<
    string,
    { timestamp: number; updates: Set<string> }
  >();
  private readonly UPDATE_DEDUP_WINDOW_MS = 5000;

  constructor(
    @InjectRepository(MessageEntity)
    private readonly messageRepo: EntityRepository<MessageEntity>,
    @InjectRepository(ConversationEntity)
    private readonly conversationRepo: EntityRepository<ConversationEntity>,
    @InjectRepository(ContactEntity)
    private readonly contactRepo: EntityRepository<ContactEntity>,
    @InjectRepository(ConnectedAccountsEntity)
    private readonly connectedAccountsRepo: EntityRepository<ConnectedAccountsEntity>,
    @InjectRepository(UserEntity)
    private readonly userRepo: EntityRepository<UserEntity>,
    private readonly em: EntityManager,
    @Inject(forwardRef(() => TelegramProvider))
    private readonly telegramProvider: TelegramProvider,
    private readonly pusherService: PusherService,
    @Inject(TelegramConfiguration.KEY)
    private readonly telegramConfig: ConfigType<typeof TelegramConfiguration>,
  ) {}

  private async getUserRole(
    userId: string,
    em: EntityManager,
  ): Promise<SenderRole> {
    const user = await em.findOne(
      UserEntity,
      { id: userId },
      { populate: ["role"] },
    );

    if (!user) {
      this.logger.error(`User not found: ${userId}`);
      return "owner";
    }

    return user.role.name === "super-admin" ? "owner" : "pa";
  }

  async onModuleInit() {
    this.logger.log("TelegramEventListener initialized");
    this.setupListenersForExistingClients().catch((error) => {
      this.logger.error("Error setting up existing listeners:", error);
    });
  }

  async onModuleDestroy() {
    this.logger.log("TelegramEventListener stopped");
  }

  private async setupListenersForExistingClients(): Promise<void> {
    try {
      const connectedAccounts = await this.connectedAccountsRepo.findAll({
        where: { platform: SocialMediaPlatform.Telegram, status: "active" },
        populate: ["user"],
      });

      for (const account of connectedAccounts) {
        if (account.user?.id) {
          if (!this.setupClients.has(account.user.id)) {
            const client = this.telegramProvider.getClientFromPool(
              account.user.id,
            );
            if (client) {
              if (client.isClosed()) {
                this.logger.log(
                  `Client for user ${account.user.id} is closed, skipping listener setup.`,
                );
              }
              this.setupListenerForUser(account.user.id);
              this.setupClients.add(account.user.id);
              this.logger.log(
                `Set up listener for new user ${account.user.id}`,
              );
            }
          }
        }
      }
    } catch (error) {
      this.logger.error(
        `Failed to set up existing listeners: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }

  public async setupListenerForUser(userId: string): Promise<void> {
    try {
      this.logger.log(`Setting up event listener for user ${userId}`);
      const client = this.telegramProvider.getClientFromPool(userId);

      if (!client) {
        this.logger.warn(`No client found in pool for user ${userId}`);
        return;
      }

      client.on("error", (error: any) => {
        this.logger.error("client error", error);
      });
      client.on("update", async (update: TdlUpdate) => {
        try {
          await this.handleUpdate(update, userId, client);
        } catch (error) {
          this.logger.error(
            `Error handling update for user ${userId}: ${error instanceof Error ? error.message : String(error)}`,
          );
        }
      });

      this.logger.log(`Event listener set up for user ${userId}`);
    } catch (error) {
      this.logger.error(
        `Failed to set up listener for user ${userId}: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }

  private isDuplicateUpdate(userId: string, update: TdlUpdate): boolean {
    const updateKey = this.getUpdateKey(update);
    if (!updateKey) return false;

    const now = Date.now();
    let userUpdates = this.processedUpdates.get(userId);

    if (!userUpdates) {
      userUpdates = { timestamp: now, updates: new Set() };
      this.processedUpdates.set(userId, userUpdates);
    }

    if (now - userUpdates.timestamp > this.UPDATE_DEDUP_WINDOW_MS) {
      userUpdates.updates.clear();
      userUpdates.timestamp = now;
    }

    if (userUpdates.updates.has(updateKey)) {
      return true;
    }

    userUpdates.updates.add(updateKey);
    return false;
  }

  private getUpdateKey(update: TdlUpdate): string | null {
    switch (update._) {
      // NOTE: this is causing a bug ,(it automatically marks messages as read when any message is received)
      // case "updateChatReadInbox":
      //   return `updateChatReadInbox:${(update as TdlUpdateChatReadInbox).chat_id}:${(update as TdlUpdateChatReadInbox).last_read_inbox_message_id}`;
      case "updateChatReadOutbox":
        return `updateChatReadOutbox:${(update as TdlUpdateChatReadOutbox).chat_id}:${(update as TdlUpdateChatReadOutbox).last_read_outbox_message_id}`;
      case "updateNewMessage":
        return `updateNewMessage:${(update as TdlUpdateNewMessage).message.id}:${(update as TdlUpdateNewMessage).message.chat_id}`;
      case "updateMessageContent":
        return `updateMessageContent:${(update as TdlUpdateMessageContent).message_id}:${(update as TdlUpdateMessageContent).chat_id}`;
      case "updateDeleteMessages":
        return `updateDeleteMessages:${(update as TdlUpdateDeleteMessages).chat_id}:${(update as TdlUpdateDeleteMessages).message_ids.join(",")}`;
      case "updateMessageSendSucceeded":
        return `updateMessageSendSucceeded:${(update as TdlUpdateMessageSendSucceeded).old_message_id}:${(update as TdlUpdateMessageSendSucceeded).message.id}`;
      default:
        return null;
    }
  }

  private async handleUpdate(
    update: TdlUpdate,
    userId: string,
    client: Client,
  ): Promise<void> {
    if (this.isDuplicateUpdate(userId, update)) {
      return;
    }

    switch (update._) {
      case "updateNewMessage":
        await this.handleNewMessage(update as TdlUpdateNewMessage, userId);
        break;
      case "updateMessageContent":
        await this.handleMessageEdit(update as TdlUpdateMessageContent, userId);
        break;
      case "updateDeleteMessages":
        await this.handleMessageDelete(
          update as TdlUpdateDeleteMessages,
          userId,
        );
        break;
      case "updateChatReadInbox":
        await this.handleReadInbox(update as TdlUpdateChatReadInbox, userId);
        break;
      case "updateChatReadOutbox":
        await this.handleReadOutbox(update as TdlUpdateChatReadOutbox, userId);
        break;
      case "updateMessageSendSucceeded":
        await this.handleMessageSendSucceeded(
          update as TdlUpdateMessageSendSucceeded,
          userId,
        );
        break;
      case "updateNewChat":
        await this.handleNewChat(update as TdlUpdateNewChat, userId);
        break;
      case "updateUserStatus":
        await this.handleUserStatus(update as TdlUpdateUserStatus, userId);
        break;
      case "updateAuthorizationState":
        break;
      case "authorizationStateReady":
        const me = await client.invoke({ _: "getMe" });
        this.logger.log(`tdlib ready for ${userId}: ${me?.id}`);
        break;
      default:
        break;
    }
  }
  private async handleNewMessage(
    update: TdlUpdateNewMessage,
    userId: string,
  ): Promise<void> {
    const em = this.em.fork();
    try {
      const message = update.message;

      if (!message || !message.content) {
        return;
      }

      if (message.content._ !== "messageText") {
        return;
      }

      const messageId = message.id?.toString();
      const chatId = message.chat_id?.toString();
      const text = message.content.text?.text;
      const sentAt = message.date
        ? new Date(message.date * 1000).toISOString()
        : undefined;

      const isOutgoing = message.is_outgoing;

      this.logger.log(
        `New ${isOutgoing ? "outgoing" : "inbound"} message for user ${userId}: ${messageId} in chat ${chatId}`,
      );

      const connectedAccount = await em.findOne(ConnectedAccountsEntity, {
        user: userId,
        platform: SocialMediaPlatform.Telegram,
      });

      if (!connectedAccount) {
        this.logger.warn(`No connected account found for user ${userId}`);
        return;
      }

      if (isOutgoing) {
        await this.saveOutboundMessage({
          userId,
          accountId: connectedAccount.id,
          messageId: messageId!,
          chatId: chatId!,
          text,
          sentAt,
          rawMessage: message,
        });
      } else {
        await this.saveInboundMessage({
          userId,
          accountId: connectedAccount.id,
          messageId: messageId!,
          chatId: chatId!,
          text,
          sentAt,
          rawMessage: message,
        });
      }
    } catch (error) {
      this.logger.error(
        `Error handling new message for user ${userId}: ${error instanceof Error ? error.message : String(error)}`,
        error instanceof Error ? error.stack : undefined,
      );
    } finally {
      em.clear();
    }
  }

  private async handleMessageEdit(
    update: TdlUpdateMessageContent,
    userId: string,
  ): Promise<void> {
    try {
      const chatId = update.chat_id?.toString();
      const messageId = update.message_id?.toString();
    } catch (error) {
      this.logger.error(
        `Error handling message edit: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }

  private async handleMessageDelete(
    update: TdlUpdateDeleteMessages,
    userId: string,
  ): Promise<void> {
    try {
      const chatId = update.chat_id?.toString();
      const messageIds = update.message_ids || [];
    } catch (error) {
      this.logger.error(
        `Error handling message delete: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }

  private async handleReadInbox(
    update: TdlUpdateChatReadInbox,
    userId: string,
  ): Promise<void> {
    try {
      const chatId = update.chat_id?.toString();

      this.logger.debug(`Messages read in chat ${chatId} for user ${userId}`);

      let conversation = await this.conversationRepo.findOne({
        platform: SocialMediaPlatform.Telegram,
        externalId: chatId,
      });
      if (!conversation) {
        conversation = await this.conversationRepo.findOne({
          platform: SocialMediaPlatform.Telegram,
          externalId: `user:${chatId}`,
        });
      }

      if (!conversation) {
        this.logger.warn(`No conversation found for chat ${chatId}`);
        return;
      }

      conversation.unreadCount = +update.unread_count;

      const message = await this.messageRepo.findOne({
        conversationId: conversation.id,
        externalMessageId: update.last_read_inbox_message_id?.toString(),
      });

      if (message) {
        message.status = "read";
        await this.em.persistAndFlush([message, conversation]);
        this.logger.log("Updated message and conversation read status");

        await this.pusherService.trigger(
          PusherChannel.PrivateMessaging,
          PusherEvent.MessageRead,
          {
            success: true,
            message: "Message marked as read",
            data: {
              messageId: message.externalMessageId,
              conversationId: conversation.externalId,
              chatId: chatId,
              platform: SocialMediaPlatform.Telegram,
              accountId: conversation.accountId,
              unreadCount: conversation.unreadCount,
              direction: "inbound",
            },
          },
        );
        this.logger.log(
          `Sent Pusher notification for read inbox message ${message.externalMessageId}`,
        );
      } else {
        await this.em.persistAndFlush(conversation);
        this.logger.log("Updated conversation unread count from Telegram");
      }
    } catch (error) {
      this.logger.error(
        `Error handling read inbox: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }

  private async handleReadOutbox(
    update: TdlUpdateChatReadOutbox,
    userId: string,
  ): Promise<void> {
    try {
      const chatId = update.chat_id?.toString();

      this.logger.debug(
        `Outbound messages read in chat ${chatId} for user ${userId}`,
      );

      let conversation = await this.conversationRepo.findOne({
        platform: SocialMediaPlatform.Telegram,
        externalId: chatId,
      });
      if (!conversation) {
        conversation = await this.conversationRepo.findOne({
          platform: SocialMediaPlatform.Telegram,
          externalId: `user:${chatId}`,
        });
      }
      const message = await this.messageRepo.findOne({
        conversationId: conversation?.id,
        externalMessageId: update.last_read_outbox_message_id?.toString(),
      });
      if (!message || !conversation) {
        this.logger.warn(
          "no outbound message or conversation found to mark as read",
        );
        return;
      }
      message.status = "read";
      await this.em.persistAndFlush(message);
      this.logger.log("Updated outbound message read status");

      await this.pusherService.trigger(
        PusherChannel.PrivateMessaging,
        PusherEvent.MessageRead,
        {
          success: true,
          message: "Outbound message marked as read",
          data: {
            messageId: message.externalMessageId,
            conversationId: conversation.externalId,
            chatId: chatId,
            platform: SocialMediaPlatform.Telegram,
            accountId: conversation.accountId,
            direction: "outbound",
          },
        },
      );
      this.logger.log(
        `Sent Pusher notification for read outbox message ${message.externalMessageId}`,
      );
    } catch (error) {
      this.logger.error(
        `Error handling read outbox: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }

  private async handleMessageSendSucceeded(
    update: TdlUpdateMessageSendSucceeded,
    userId: string,
  ): Promise<void> {
    try {
      const oldMessageId = update.old_message_id?.toString();
      const newMessageId = update.message.id?.toString();
      const chatId = update.message.chat_id?.toString();

      this.logger.debug(
        `Message send succeeded for user ${userId}: updating ${oldMessageId} -> ${newMessageId} in chat ${chatId}`,
      );

      const message = await this.messageRepo.findOne({
        externalMessageId: oldMessageId,
      });

      if (!message) {
        this.logger.warn(
          `No message found with temporary ID ${oldMessageId}, skipping update`,
        );
        return;
      }

      message.externalMessageId = newMessageId!;
      message.status = "sent";

      await this.em.persistAndFlush(message);

      this.logger.log(
        `Updated message ID from ${oldMessageId} to ${newMessageId} and marked as sent`,
      );
    } catch (error) {
      this.logger.error(
        `Error handling message send succeeded: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }

  private async handleUserStatus(
    update: TdlUpdateUserStatus,
    userId: string,
  ): Promise<void> {
    try {
      const externalUserId = update.user_id?.toString();
      const status = update.status;

      if (!externalUserId || !status) {
        return;
      }

      let isOnline = false;
      let lastSeen: Date | undefined;

      switch (status._) {
        case "userStatusOnline":
          isOnline = true;
          if (status.expires) {
            lastSeen = new Date(status.expires * 1000);
          }
          break;
        case "userStatusOffline":
          isOnline = false;
          if (status.was_online) {
            lastSeen = new Date(status.was_online * 1000);
          }
          break;
        case "userStatusRecently":
          isOnline = false;
          lastSeen = new Date();
          break;
        case "userStatusLastWeek":
        case "userStatusLastMonth":
          isOnline = false;
          break;
        default:
          return;
      }

      const conversations = await this.conversationRepo.find({
        platform: SocialMediaPlatform.Telegram,
        externalId: externalUserId,
      });

      if (conversations.length === 0) {
        this.logger.debug(
          `No conversation found for user ${externalUserId}, skipping status update`,
        );
        return;
      }

      for (const conversation of conversations) {
        conversation.online = isOnline;
        if (lastSeen) {
          conversation.lastSeen = lastSeen;
        }
      }

      await this.em.persistAndFlush(conversations);

      this.logger.debug(
        `Updated ${conversations.length} conversation(s) online status for user ${externalUserId}: ${isOnline ? "online" : "offline"}`,
      );
    } catch (error) {
      this.logger.error(
        `Error handling user status: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }

  private async handleNewChat(
    update: TdlUpdateNewChat,
    userId: string,
  ): Promise<void> {
    const em = this.em.fork();
    try {
      const chat = update.chat;

      if (!chat || !chat.id) {
        this.logger.warn("Invalid chat data in updateNewChat");
        return;
      }

      const chatId = chat.id.toString();
      const title = chat.title || chatId;
      const unreadCount = chat.unread_count || 0;

      this.logger.log(
        `New chat received for user ${userId}: ${chatId} - ${title}`,
      );

      const connectedAccount = await em.findOne(ConnectedAccountsEntity, {
        user: userId,
        platform: SocialMediaPlatform.Telegram,
      });

      if (!connectedAccount) {
        this.logger.warn(`No connected account found for user ${userId}`);
        return;
      }

      const conversation = await this.findOrCreateConversation({
        em,
        chatId: chatId,
        accountId: connectedAccount.id,
        userId: userId,
        conversationName: title,
        unreadCount: unreadCount,
        platformData: chat,
      });

      conversation.name = title;
      conversation.unreadCount = unreadCount;
      conversation.platformData = this.toSafeJson(chat) as Record<
        string,
        unknown
      >;

      await em.persistAndFlush(conversation);
      this.logger.log(
        `Updated conversation from updateNewChat: ${conversation.externalId} - ${conversation.name}`,
      );
    } catch (error) {
      this.logger.error(
        `Error handling new chat for user ${userId}: ${error instanceof Error ? error.message : String(error)}`,
        error instanceof Error ? error.stack : undefined,
      );
    } finally {
      em.clear();
    }
  }

  private async saveOutboundMessage(params: {
    userId: string;
    accountId: string;
    messageId: string;
    chatId: string;
    text?: string;
    sentAt?: string;
    rawMessage: TdlMessage;
  }): Promise<void> {
    const em = this.em.fork();
    try {
      const conversation = await this.findOrCreateConversation({
        em,
        chatId: params.chatId,
        accountId: params.accountId,
        userId: params.userId,
        text: params.text,
      });

      conversation.text = params.text;
      conversation.lastMessageStatus = "delivered";
      await em.persistAndFlush(conversation);

      const existingMessage = await em.findOne(MessageEntity, {
        externalMessageId: params.messageId,
        conversationId: conversation.id,
      });

      if (!existingMessage) {
        const senderRole = await this.getUserRole(params.userId, em);

        const messageEntity = em.create(MessageEntity, {
          conversationId: conversation,
          sentBy: em.getReference(UserEntity, params.userId),
          externalMessageId: params.messageId,
          direction: "outbound",
          status: "delivered",
          role: senderRole,
          text: params.text,
          out: true,
          sentAt: params.sentAt ? new Date(params.sentAt) : null,
          provideOriginalPayload: this.toSafeJson(params.rawMessage) || {},
        });

        await em.persistAndFlush(messageEntity);
        this.logger.log(`Saved outbound message ${params.messageId}`);

        await this.sendPusherNotification({
          userId: params.userId,
          accountId: params.accountId,
          messageId: params.messageId,
          chatId: params.chatId,
          text: params.text,
          sentAt: params.sentAt,
          direction: "outbound",
        });
      } else {
        this.logger.debug(
          `Message ${params.messageId} already exists, updating to delivered status`,
        );

        existingMessage.status = "delivered";
        existingMessage.sentAt = params.sentAt
          ? new Date(params.sentAt)
          : existingMessage.sentAt;
        existingMessage.provideOriginalPayload =
          this.toSafeJson(params.rawMessage) ||
          existingMessage.provideOriginalPayload;

        await em.persistAndFlush(existingMessage);
        this.logger.log(
          `Updated outbound message ${params.messageId} to delivered status`,
        );

        await this.sendPusherNotification({
          userId: params.userId,
          accountId: params.accountId,
          messageId: params.messageId,
          chatId: params.chatId,
          text: params.text,
          sentAt: params.sentAt,
          direction: "outbound",
        });
      }
    } catch (error) {
      this.logger.error(
        `Failed to save outbound message ${params.messageId}: ${error instanceof Error ? error.message : String(error)}`,
      );
    } finally {
      em.clear();
    }
  }

  private async saveInboundMessage(params: {
    userId: string;
    accountId: string;
    messageId: string;
    chatId: string;
    text?: string;
    sentAt?: string;
    rawMessage: TdlMessage;
  }): Promise<void> {
    const em = this.em.fork();
    try {
      const conversation = await this.findOrCreateConversation({
        em,
        chatId: params.chatId,
        accountId: params.accountId,
        userId: params.userId,
        text: params.text,
      });

      conversation.text = params.text;
      conversation.lastMessageStatus = "delivered";
      await em.persistAndFlush(conversation);

      const existingMessage = await em.findOne(MessageEntity, {
        externalMessageId: params.messageId,
        conversationId: conversation.id,
      });

      if (!existingMessage) {
        const senderRole = await this.getUserRole(params.userId, em);

        const messageEntity = em.create(MessageEntity, {
          conversationId: conversation,
          externalMessageId: params.messageId,
          direction: "inbound",
          status: "delivered",
          role: senderRole,
          text: params.text,
          out: false,
          sentAt: params.sentAt ? new Date(params.sentAt) : null,
          provideOriginalPayload: this.toSafeJson(params.rawMessage) || {},
        });

        await em.persistAndFlush(messageEntity);
        this.logger.log(`Saved inbound message ${params.messageId}`);

        await this.sendPusherNotification({
          userId: params.userId,
          accountId: params.accountId,
          messageId: params.messageId,
          chatId: params.chatId,
          text: params.text,
          sentAt: params.sentAt,
          direction: "inbound",
        });
      } else {
        this.logger.debug(
          `Message ${params.messageId} already exists, skipping`,
        );
      }
    } catch (error) {
      this.logger.error(
        `Failed to save inbound message ${params.messageId}: ${error instanceof Error ? error.message : String(error)}`,
      );
    } finally {
      em.clear();
    }
  }

  private async sendPusherNotification(params: {
    userId: string;
    accountId: string;
    messageId: string;
    chatId: string;
    text?: string;
    sentAt?: string;
    direction?: string;
  }): Promise<void> {
    const em = this.em.fork();
    try {
      let conversation = await em.findOne(ConversationEntity, {
        externalId: params.chatId,
        platform: SocialMediaPlatform.Telegram,
        accountId: params.accountId,
      });

      if (!conversation) {
        conversation = await em.findOne(ConversationEntity, {
          externalId: `user:${params.chatId}`,
          platform: SocialMediaPlatform.Telegram,
          accountId: params.accountId,
        });
      }
      if (!conversation) {
        this.logger.warn(
          `Conversation not found for Pusher notification: ${params.chatId}`,
        );
        return;
      }

      const recentMessages = await em.find(
        MessageEntity,
        { conversationId: conversation.id },
        {
          orderBy: { createdAt: "DESC" },
          limit: 5,
          populate: ["sentBy", "sentBy.role"],
        },
      );

      const eventName =
        params.direction === "outbound"
          ? PusherEvent.Outbound
          : PusherEvent.Inbound;
      const eventMessage =
        params.direction === "outbound" ? "Message sent" : "Message received";

      await this.pusherService.trigger(
        PusherChannel.PrivateMessaging,
        eventName,
        {
          success: true,
          message: eventMessage,
          data: {
            message: {
              externalMessageId: params.messageId,
              conversationExternalId: params.chatId,
              text: params.text,
              sentAt: params.sentAt,
            },
            platform: SocialMediaPlatform.Telegram,
            accountId: params.accountId,
            messages: recentMessages.map((msg) => ({
              id: msg.id,
              externalMessageId: msg.externalMessageId,
              direction: msg.direction,
              status: msg.status,
              role: msg.role,
              text: msg.text,
              out: msg.out,
              sentAt: msg.sentAt,
              sentBy: msg.sentBy
                ? {
                    id: msg.sentBy.id,
                    firstName: msg.sentBy.firstName,
                    lastName: msg.sentBy.lastName,
                    email: msg.sentBy.email,
                    role: { name: msg.sentBy.role.name },
                  }
                : null,
              createdAt: msg.createdAt,
              updatedAt: msg.updatedAt,
            })),
          },
        },
      );

      this.logger.log(
        `Sent Pusher notification for ${eventName} message ${params.messageId}`,
      );
    } catch (error) {
      this.logger.error(
        `Failed to send Pusher notification: ${error instanceof Error ? error.message : String(error)}`,
      );
    } finally {
      em.clear();
    }
  }

  private async findOrCreateConversation(params: {
    em: EntityManager;
    chatId: string;
    accountId: string;
    userId: string;
    conversationName?: string;
    text?: string;
    unreadCount?: number;
    platformData?: unknown;
  }): Promise<ConversationEntity> {
    const name = await this.resolveConversationNameFromContact(
      params.em,
      params.chatId,
      params.userId,
      params.conversationName || params.chatId,
    );

    let conversation = await this.findConversationByName(
      params.em,
      name,
      params.userId,
      params.chatId,
      params.accountId,
    );

    if (!conversation) {
      conversation = await this.findConversationByExternalId(
        params.em,
        params.chatId,
        params.userId,
      );
    }

    if (conversation) {
      await this.updateConversationFields(conversation, params, name);
      return conversation;
    }

    return this.createNewConversation(params.em, params, name);
  }

  private async resolveConversationNameFromContact(
    em: EntityManager,
    chatId: string,
    userId: string,
    fallbackName: string,
  ): Promise<string> {
    if (fallbackName !== chatId) return fallbackName;

    const contactExternalId = chatId.replace("user:", "");
    const contact = await em.findOne(ContactEntity, {
      externalId: contactExternalId,
      platform: SocialMediaPlatform.Telegram,
      user: userId,
    });

    return contact?.displayName || fallbackName;
  }

  private async findConversationByName(
    em: EntityManager,
    name: string,
    userId: string,
    chatId: string,
    accountId: string,
  ): Promise<ConversationEntity | null> {
    const conversation = await em.findOne(ConversationEntity, {
      platform: SocialMediaPlatform.Telegram,
      name,
      user: userId,
    });

    if (
      conversation &&
      conversation.externalId !== chatId &&
      conversation.externalId !== `user:${chatId}`
    ) {
      this.logger.log(
        `Updating conversation ${conversation.externalId} -> ${chatId} (name: ${name})`,
      );
      conversation.externalId = chatId;
      conversation.accountId = accountId;
    }

    return conversation;
  }

  private async findConversationByExternalId(
    em: EntityManager,
    chatId: string,
    userId: string,
  ): Promise<ConversationEntity | null> {
    let conversation = await em.findOne(ConversationEntity, {
      externalId: chatId,
      platform: SocialMediaPlatform.Telegram,
      user: userId,
    });

    if (!conversation) {
      conversation = await em.findOne(ConversationEntity, {
        externalId: `user:${chatId}`,
        platform: SocialMediaPlatform.Telegram,
        user: userId,
      });
    }

    return conversation;
  }

  private async updateConversationFields(
    conversation: ConversationEntity,
    params: {
      em: EntityManager;
      chatId: string;
      text?: string;
      unreadCount?: number;
      platformData?: unknown;
    },
    name: string,
  ): Promise<void> {
    let updated = false;

    if (conversation.externalId !== params.chatId) {
      conversation.externalId = params.chatId;
      updated = true;
    }

    if (conversation.name !== name && name !== conversation.externalId) {
      this.logger.log("updating name", conversation.name, "->", name);
      conversation.name = name;
      updated = true;
    }

    if (params.text && conversation.text !== params.text) {
      conversation.text = params.text;
      updated = true;
    }

    if (
      params.unreadCount !== undefined &&
      conversation.unreadCount !== params.unreadCount
    ) {
      conversation.unreadCount = params.unreadCount;
      updated = true;
    }

    if (params.platformData) {
      const safeData = this.toSafeJson(params.platformData) as Record<
        string,
        unknown
      >;
      if (
        JSON.stringify(conversation.platformData) !== JSON.stringify(safeData)
      ) {
        conversation.platformData = safeData;
        updated = true;
      }
    }

    if (updated) {
      await params.em.persistAndFlush(conversation);
      this.logger.log(
        `Updated existing conversation: ${conversation.externalId}`,
      );
    }
  }

  private async createNewConversation(
    em: EntityManager,
    params: {
      chatId: string;
      accountId: string;
      userId: string;
      text?: string;
      unreadCount?: number;
      platformData?: unknown;
    },
    name: string,
  ): Promise<ConversationEntity> {
    const conversation = em.create(ConversationEntity, {
      externalId: params.chatId,
      platform: SocialMediaPlatform.Telegram,
      accountId: params.accountId,
      name,
      user: params.userId,
      unreadCount: params.unreadCount || 0,
      state: "open",
      text: params.text,
      platformData: this.toSafeJson(params.platformData) as Record<
        string,
        unknown
      >,
    });

    try {
      await em.persistAndFlush(conversation);
      this.logger.log(`Created new conversation: ${conversation.externalId}`);
      return conversation;
    } catch (error) {
      if (error instanceof UniqueConstraintViolationException) {
        this.logger.warn(
          `Conversation already exists for chat ${params.chatId}, using existing record`,
        );
        const existing = await this.findConversationByExternalId(
          em,
          params.chatId,
          params.userId,
        );
        if (existing) {
          return existing;
        }
      }
      throw error;
    }
  }

  private toSafeJson<T>(payload: T): unknown {
    try {
      return JSON.parse(JSON.stringify(payload));
    } catch (error) {
      this.logger.error("JSON stringify/parse error:", error);
    }

    return payload;
  }
}
