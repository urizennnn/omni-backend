import { Processor, WorkerHost } from "@nestjs/bullmq";
import { Job } from "bullmq";
import { Injectable, Logger, Inject } from "@nestjs/common";
import { InjectRepository } from "@mikro-orm/nestjs";
import { EntityManager, EntityRepository } from "@mikro-orm/core";
import { ConnectedAccountsEntity } from "@app/entities/connected-accounts.entity";
import { ContactEntity } from "@app/entities/contact.entity";
import { ConversationEntity } from "@app/entities/conversation.entity";
import { MessageEntity } from "@app/entities/messages.entity";
import { UserEntity } from "@app/entities/user.entity";
import { UserSocialSessionEntity } from "@app/entities/user-social-session.entity";
import { SocialMediaPlatform } from "@app/types";
import { TelegramConfiguration } from "@app/config/telegram.config";
import { ApplicationConfiguration } from "@app/config/app.config";
import { ConfigType } from "@nestjs/config";
import { createTelegramClient } from "../social-media-registry/providers/telegram/telegram-client.factory";
import { Client } from "tdl";
import { QueueName } from "./queue.constants";

export interface ContactsSyncJobData {
  accountId: string;
  platform: SocialMediaPlatform;
  userId: string;
}

@Processor(QueueName.ContactsSync, {
  concurrency: 2,
})
@Injectable()
export class ContactsSyncProcessor extends WorkerHost {
  private readonly logger = new Logger(ContactsSyncProcessor.name);

  constructor(
    @Inject(TelegramConfiguration.KEY)
    private readonly telegramConfig: ConfigType<typeof TelegramConfiguration>,
    @Inject(ApplicationConfiguration.KEY)
    private readonly appConfig: ConfigType<typeof ApplicationConfiguration>,
    @InjectRepository(ConnectedAccountsEntity)
    private readonly accountRepo: EntityRepository<ConnectedAccountsEntity>,
    @InjectRepository(ContactEntity)
    private readonly contactRepo: EntityRepository<ContactEntity>,
    @InjectRepository(UserEntity)
    private readonly userRepo: EntityRepository<UserEntity>,
    @InjectRepository(UserSocialSessionEntity)
    private readonly sessionRepo: EntityRepository<UserSocialSessionEntity>,
    private readonly em: EntityManager,
  ) {
    super();
  }

  async process(job: Job<ContactsSyncJobData>): Promise<void> {
    const { accountId, platform, userId } = job.data;
    this.logger.log(
      `Processing contacts sync for account ${accountId} (${platform})`,
    );

    const fork = this.em.fork();

    try {
      const account = await fork.findOne(
        ConnectedAccountsEntity,
        {
          id: accountId,
        },
        { populate: ["user"] },
      );

      if (!account) {
        this.logger.warn(`Account ${accountId} not found, skipping sync`);
        return;
      }

      if (account.status !== "active") {
        this.logger.log(`Account ${accountId} is not active, skipping sync`);
        return;
      }

      if (platform !== SocialMediaPlatform.Telegram) {
        this.logger.debug(
          `Contact sync for ${platform} is not yet implemented`,
        );
        return;
      }

      await this.syncTelegramContacts(fork, account, userId);
      await this.syncTelegramConversations(fork, account, userId);

      this.logger.log(
        `Completed contacts and conversations sync for account ${accountId}`,
      );
    } catch (error) {
      this.logger.error(
        `Failed to sync contacts for account ${accountId}: ${error instanceof Error ? error.message : String(error)}`,
      );
      throw error;
    }
  }

  private async syncTelegramContacts(
    em: EntityManager,
    account: ConnectedAccountsEntity,
    userId: string,
  ): Promise<void> {
    try {
      const superAdminEmail = this.appConfig.superAdminEmail?.trim();
      if (!superAdminEmail) {
        this.logger.warn(
          "Super admin email not configured, skipping contact sync",
        );
        return;
      }

      const session = await em.findOne(
        UserSocialSessionEntity,
        {
          platform: SocialMediaPlatform.Telegram,
          user: { email: superAdminEmail },
        },
        { populate: ["user"] },
      );

      if (!session?.sessionToken) {
        this.logger.warn(
          `No session token found for super admin on Telegram, skipping contact sync`,
        );
        return;
      }

      const client = createTelegramClient(
        this.telegramConfig,
        session.sessionToken,
      );

      this.logger.log("Connected to Telegram for contact sync");

      try {
        const contacts = await client.invoke({
          _: "getContacts",
        });
        const userIds: number[] = contacts?.user_ids || [];

        const results = await Promise.allSettled(
          userIds.map((id) => client.invoke({ _: "getUser", user_id: id })),
        );

        const user = await em.findOne(UserEntity, { id: userId });
        if (!user) {
          this.logger.error(`User not found: ${userId}`);
          return;
        }

        let newContactsCount = 0;
        let updatedContactsCount = 0;

        for (const result of results) {
          if (result.status === "fulfilled" && result.value) {
            const userData = result.value as Record<string, unknown>;

            if (!(userData.is_contact as boolean)) {
              continue;
            }

            const externalId = (userData.id as number)?.toString();
            if (!externalId) {
              continue;
            }

            let username: string | undefined;
            if (
              typeof userData.usernames === "object" &&
              userData.usernames !== null
            ) {
              const usernamesObj = userData.usernames as Record<
                string,
                unknown
              >;
              if (
                Array.isArray(usernamesObj.active_usernames) &&
                usernamesObj.active_usernames.length > 0
              ) {
                username = usernamesObj.active_usernames[0] as string;
              }
            }

            let displayName: string | undefined;
            if (!username) {
              const firstName = (userData.first_name as string) || "";
              const lastName = (userData.last_name as string) || "";
              const combinedName = `${firstName} ${lastName}`.trim();
              username = combinedName || undefined;
              displayName = combinedName || undefined;
            } else {
              const firstName = (userData.first_name as string) || "";
              const lastName = (userData.last_name as string) || "";
              displayName = `${firstName} ${lastName}`.trim() || username;
            }

            try {
              let contact = await em.findOne(ContactEntity, {
                user: user,
                platform: SocialMediaPlatform.Telegram,
                externalId: externalId,
              });

              if (contact) {
                contact.username = username;
                contact.displayName = displayName;
                contact.platformData = this.toSafeJson(userData) as Record<
                  string,
                  unknown
                >;
                updatedContactsCount++;
                this.logger.log(`Updated contact: ${externalId}`);
              } else {
                contact = em.create(ContactEntity, {
                  user: user,
                  platform: SocialMediaPlatform.Telegram,
                  externalId: externalId,
                  username: username,
                  displayName: displayName,
                  platformData: this.toSafeJson(userData) as Record<
                    string,
                    unknown
                  >,
                });
                newContactsCount++;
                this.logger.log(`Created new contact: ${externalId}`);
              }

              em.persist(contact);
            } catch (error) {
              this.logger.error(
                `Failed to save contact ${externalId}: ${error instanceof Error ? error.message : String(error)}`,
              );
            }
          }
        }

        await em.flush();

        this.logger.log(
          `Synced Telegram contacts: ${newContactsCount} new, ${updatedContactsCount} updated. Total processed: ${results.length}`,
        );
      } finally {
        await client.close();
      }
    } catch (error) {
      this.logger.error(
        `Failed to sync Telegram contacts: ${error instanceof Error ? error.message : String(error)}`,
      );
      throw error;
    }
  }

  private async syncTelegramConversations(
    em: EntityManager,
    account: ConnectedAccountsEntity,
    userId: string,
  ): Promise<void> {
    try {
      const superAdminEmail = this.appConfig.superAdminEmail?.trim();
      if (!superAdminEmail) {
        this.logger.warn(
          "Super admin email not configured, skipping conversation sync",
        );
        return;
      }

      const session = await em.findOne(
        UserSocialSessionEntity,
        {
          platform: SocialMediaPlatform.Telegram,
          user: { email: superAdminEmail },
        },
        { populate: ["user"] },
      );

      if (!session?.sessionToken) {
        this.logger.warn(
          `No session token found for super admin on Telegram, skipping conversation sync`,
        );
        return;
      }

      const client = createTelegramClient(
        this.telegramConfig,
        session.sessionToken,
      );

      this.logger.log("Connected to Telegram for conversation sync");

      try {
        const user = await em.findOne(UserEntity, { id: userId });
        if (!user) {
          this.logger.error(`User not found: ${userId}`);
          return;
        }

        const chats = await client.invoke({
          _: "getChats",
          chat_list: { _: "chatListMain" },
          limit: 100,
        });

        const chatIds: number[] = chats?.chat_ids || [];

        const results = await Promise.allSettled(
          chatIds.map((id) => client.invoke({ _: "getChat", chat_id: id })),
        );

        let newConversationsCount = 0;
        let updatedConversationsCount = 0;

        for (const result of results) {
          if (result.status === "fulfilled" && result.value) {
            const chatData = result.value as Record<string, unknown>;

            const chatId = (chatData.id as number)?.toString();
            if (!chatId) {
              continue;
            }

            let conversationName = (chatData.title as string) || chatId;
            let externalId = chatId;

            if (
              typeof chatData.type === "object" &&
              chatData.type !== null &&
              (chatData.type as Record<string, unknown>)._ === "chatTypePrivate"
            ) {
              const contactUserId = (
                chatData.type as Record<string, unknown>
              ).user_id?.toString();
              if (contactUserId) {
                externalId = `user:${contactUserId}`;

                const contact = await em.findOne(ContactEntity, {
                  externalId: contactUserId,
                  platform: SocialMediaPlatform.Telegram,
                  user: user,
                });

                if (contact?.displayName) {
                  conversationName = contact.displayName;
                }
              }
            }

            try {
              let conversation = await em.findOne(ConversationEntity, {
                externalId: externalId,
                platform: SocialMediaPlatform.Telegram,
                accountId: account.id,
              });

              if (conversation) {
                conversation.name = conversationName;
                conversation.platformData = this.toSafeJson(chatData) as Record<
                  string,
                  unknown
                >;
                updatedConversationsCount++;
                this.logger.log(`Updated conversation: ${externalId}`);
              } else {
                conversation = em.create(ConversationEntity, {
                  externalId: externalId,
                  platform: SocialMediaPlatform.Telegram,
                  accountId: account.id,
                  name: conversationName,
                  user: userId,
                  unreadCount: (chatData.unread_count as number) || 0,
                  state: "open",
                  platformData: this.toSafeJson(chatData) as Record<
                    string,
                    unknown
                  >,
                });
                newConversationsCount++;
                this.logger.log(`Created new conversation: ${externalId}`);
              }

              const lastMessageText = await this.fetchAndStoreMessages(
                client,
                em,
                conversation,
                chatId,
              );

              if (lastMessageText) {
                conversation.text = lastMessageText;
              }

              em.persist(conversation);
            } catch (error) {
              this.logger.error(
                `Failed to save conversation ${externalId}: ${error instanceof Error ? error.message : String(error)}`,
              );
            }
          }
        }

        await em.flush();

        this.logger.log(
          `Synced Telegram conversations: ${newConversationsCount} new, ${updatedConversationsCount} updated. Total processed: ${results.length}`,
        );
      } finally {
        await client.close();
      }
    } catch (error) {
      this.logger.error(
        `Failed to sync Telegram conversations: ${error instanceof Error ? error.message : String(error)}`,
      );
      throw error;
    }
  }

  private async fetchAndStoreMessages(
    client: Client,
    em: EntityManager,
    conversation: ConversationEntity,
    chatId: string,
  ): Promise<string | undefined> {
    try {
      let lastMessageText: string | undefined;
      let fromMessageId = 0;
      let hasMore = true;
      const batchSize = 100;

      while (hasMore) {
        const chatHistory = await client.invoke({
          _: "getChatHistory",
          chat_id: parseInt(chatId),
          limit: batchSize,
          from_message_id: fromMessageId,
          offset: 0,
          only_local: false,
        });

        const messages = ((chatHistory as Record<string, unknown>).messages ||
          []) as Record<string, unknown>[];

        if (messages.length === 0) {
          hasMore = false;
          break;
        }

        for (const message of messages) {
          const messageId = (message.id as number)?.toString();
          if (!messageId) {
            continue;
          }

          const existingMessage = await em.findOne(MessageEntity, {
            externalMessageId: messageId,
            conversationId: conversation.id,
          });

          if (existingMessage) {
            continue;
          }

          const isOutgoing = message.is_outgoing as boolean;
          const content = message.content as Record<string, unknown>;
          let messageText: string | undefined;

          if (content?._ === "messageText") {
            const textObj = content.text as Record<string, unknown>;
            messageText = textObj?.text as string;
          }

          if (!lastMessageText && messageText) {
            lastMessageText = messageText;
          }

          const messageDate = message.date as number;
          const sentAt = messageDate ? new Date(messageDate * 1000) : null;

          const messageEntity = em.create(MessageEntity, {
            conversationId: conversation,
            externalMessageId: messageId,
            direction: isOutgoing ? "outbound" : "inbound",
            status: "delivered",
            role: "owner",
            text: messageText,
            out: isOutgoing,
            sentAt: sentAt,
            provideOriginalPayload: this.toSafeJson(message) || {},
          });

          em.persist(messageEntity);
        }

        if (messages.length < batchSize) {
          hasMore = false;
        } else {
          const lastMessage = messages[messages.length - 1];
          fromMessageId = (lastMessage!.id as number) || 0;
        }
      }

      this.logger.log(
        `Saved messages for conversation ${conversation.externalId}`,
      );

      return lastMessageText;
    } catch (error) {
      this.logger.error(
        `Failed to fetch and store messages for conversation ${conversation.externalId}: ${error instanceof Error ? error.message : String(error)}`,
      );
      return undefined;
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
