import { Processor, WorkerHost } from "@nestjs/bullmq";
import { Job } from "bullmq";
import { Injectable, Logger } from "@nestjs/common";
import { InjectRepository } from "@mikro-orm/nestjs";
import { EntityManager, EntityRepository } from "@mikro-orm/core";
import { ContactEntity } from "@app/entities/contact.entity";
import { ConversationEntity } from "@app/entities/conversation.entity";
import { MessageEntity } from "@app/entities/messages.entity";
import { ConnectedAccountsEntity } from "@app/entities/connected-accounts.entity";
import { UserEntity } from "@app/entities/user.entity";
import { SocialMediaPlatform } from "@app/types";

export interface StoreContactsJobData {
  type: "contacts";
  platform: SocialMediaPlatform;
  userId: string;
  contacts: Array<{
    externalId: string;
    username?: string;
    displayName?: string;
    platformData: Record<string, unknown>;
  }>;
}

export interface StoreConversationsJobData {
  type: "conversations";
  platform: SocialMediaPlatform;
  userId: string;
  accountId: string;
  conversations: Array<{
    externalId: string;
    name: string;
    unreadCount?: number;
    platformData: Record<string, unknown>;
    messages?: Array<{
      externalMessageId: string;
      direction: "inbound" | "outbound";
      status: "sent" | "delivered" | "read" | "failed";
      text?: string;
      out: boolean;
      sentAt?: Date | null;
      platformData: Record<string, unknown>;
    }>;
    lastMessageText?: string;
  }>;
}

export interface StoreMessagesJobData {
  type: "messages";
  platform: SocialMediaPlatform;
  conversationId: string;
  messages: Array<{
    externalMessageId: string;
    direction: "inbound" | "outbound";
    status: "sent" | "delivered" | "read" | "failed";
    text?: string;
    out: boolean;
    sentAt?: Date | null;
    platformData: Record<string, unknown>;
  }>;
}

export type ConnectorJobData =
  | StoreContactsJobData
  | StoreConversationsJobData
  | StoreMessagesJobData;

@Processor("platform-connection", {
  concurrency: 10,
})
@Injectable()
export class ConnectorProcessor extends WorkerHost {
  private readonly logger = new Logger(ConnectorProcessor.name);

  constructor(
    @InjectRepository(ContactEntity)
    private readonly contactRepo: EntityRepository<ContactEntity>,
    @InjectRepository(ConversationEntity)
    private readonly conversationRepo: EntityRepository<ConversationEntity>,
    @InjectRepository(MessageEntity)
    private readonly messageRepo: EntityRepository<MessageEntity>,
    @InjectRepository(ConnectedAccountsEntity)
    private readonly connectedAccountsRepo: EntityRepository<ConnectedAccountsEntity>,
    @InjectRepository(UserEntity)
    private readonly userRepo: EntityRepository<UserEntity>,
    private readonly em: EntityManager,
  ) {
    super();
  }

  async process(job: Job<ConnectorJobData>): Promise<void> {
    const { type } = job.data;

    this.logger.log(
      `Processing connector job: ${type} for platform ${job.data.platform}`,
    );

    try {
      switch (type) {
        case "contacts":
          await this.storeContacts(job.data);
          break;
        case "conversations":
          await this.storeConversations(job.data);
          break;
        case "messages":
          await this.storeMessages(job.data);
          break;
        default:
          this.logger.error(`Unknown connector job type: ${type}`);
      }
    } catch (error) {
      this.logger.error(
        `Failed to process connector job ${type}: ${error instanceof Error ? error.message : String(error)}`,
      );
      throw error;
    }
  }

  private async storeContacts(data: StoreContactsJobData): Promise<void> {
    const { platform, userId, contacts } = data;
    const em = this.em.fork();

    try {
      const user = await em.findOne(UserEntity, { id: userId });
      if (!user) {
        this.logger.error(`User ${userId} not found`);
        return;
      }

      let newCount = 0;
      let updatedCount = 0;

      for (const contactData of contacts) {
        try {
          let { externalId } = contactData;

          // Try to find existing contact
          let contact = await em.findOne(ContactEntity, {
            user,
            platform,
            externalId,
          });

          // Try with prefixed external ID if not found
          if (!contact) {
            const prefixedExternalId = `user:${externalId}`;
            contact = await em.findOne(ContactEntity, {
              user,
              platform,
              externalId: prefixedExternalId,
            });
            if (contact) {
              externalId = prefixedExternalId;
            }
          }

          if (!contact) {
            // Create new contact
            contact = em.create(ContactEntity, {
              user,
              platform,
              externalId,
              username: contactData.username,
              displayName: contactData.displayName,
              platformData: contactData.platformData,
            });
            newCount++;
            this.logger.log(`Created new contact: ${externalId}`);
          } else {
            // Update existing contact
            contact.username = contactData.username;
            contact.displayName = contactData.displayName;
            contact.platformData = contactData.platformData;
            updatedCount++;
            this.logger.log(`Updated contact: ${externalId}`);
          }

          await em.persistAndFlush(contact);
        } catch (error) {
          this.logger.error(
            `Failed to save contact ${contactData.externalId}: ${error instanceof Error ? error.message : String(error)}`,
          );
        }
      }

      this.logger.log(
        `Stored ${newCount} new contacts and updated ${updatedCount} contacts for user ${userId} on ${platform}`,
      );
    } catch (error) {
      this.logger.error(
        `Failed to store contacts: ${error instanceof Error ? error.message : String(error)}`,
      );
      throw error;
    }
  }

  private async storeConversations(
    data: StoreConversationsJobData,
  ): Promise<void> {
    const { platform, userId, accountId, conversations } = data;
    const em = this.em.fork();

    try {
      const user = await em.findOne(UserEntity, { id: userId });
      if (!user) {
        this.logger.error(`User ${userId} not found`);
        return;
      }

      const connectedAccount = await em.findOne(ConnectedAccountsEntity, {
        id: accountId,
      });

      if (!connectedAccount) {
        this.logger.error(
          `Connected account ${accountId} not found for user ${userId}`,
        );
        return;
      }

      let newCount = 0;
      let updatedCount = 0;

      for (const conversationData of conversations) {
        try {
          let { externalId } = conversationData;

          // Try to find by name first
          let conversation = await em.findOne(ConversationEntity, {
            platform,
            name: conversationData.name,
            user: userId,
          });

          // Update IDs if found by name but IDs differ
          if (
            conversation &&
            (conversation.externalId !== externalId ||
              conversation.accountId !== connectedAccount.id)
          ) {
            this.logger.log(
              `Updating conversation ${conversation.externalId} -> ${externalId} (name: ${conversationData.name})`,
            );
            conversation.externalId = externalId;
            conversation.accountId = connectedAccount.id;
          }

          // Try to find by external ID
          if (!conversation) {
            conversation = await em.findOne(ConversationEntity, {
              externalId,
              platform,
              user: userId,
            });

            // Try with prefixed external ID
            if (!conversation) {
              const prefixedExternalId = `user:${externalId}`;
              conversation = await em.findOne(ConversationEntity, {
                externalId: prefixedExternalId,
                platform,
                user: userId,
              });
              if (conversation) {
                externalId = prefixedExternalId;
              }
            }
          }

          if (!conversation) {
            // Create new conversation
            conversation = em.create(ConversationEntity, {
              externalId,
              platform,
              accountId: connectedAccount.id,
              name: conversationData.name,
              user: userId,
              unreadCount: conversationData.unreadCount || 0,
              state: "open",
              platformData: conversationData.platformData,
              text: conversationData.lastMessageText,
            });
            newCount++;
            this.logger.log(`Created new conversation: ${externalId}`);
          } else {
            // Update existing conversation
            conversation.name = conversationData.name;
            conversation.platformData = conversationData.platformData;
            if (conversationData.lastMessageText) {
              conversation.text = conversationData.lastMessageText;
            }
            updatedCount++;
            this.logger.log(`Updated conversation: ${externalId}`);
          }

          em.persist(conversation);

          // Store messages if provided
          if (
            conversationData.messages &&
            conversationData.messages.length > 0
          ) {
            await this.storeMessagesForConversation(
              em,
              conversation,
              conversationData.messages,
            );
          }
        } catch (error) {
          this.logger.error(
            `Failed to save conversation ${conversationData.externalId}: ${error instanceof Error ? error.message : String(error)}`,
          );
        }
      }

      await em.flush();

      this.logger.log(
        `Stored ${newCount} new conversations and updated ${updatedCount} conversations for user ${userId} on ${platform}`,
      );
    } catch (error) {
      this.logger.error(
        `Failed to store conversations: ${error instanceof Error ? error.message : String(error)}`,
      );
      throw error;
    }
  }

  private async storeMessages(data: StoreMessagesJobData): Promise<void> {
    const { conversationId, messages } = data;
    const em = this.em.fork();

    try {
      const conversation = await em.findOne(ConversationEntity, {
        id: conversationId,
      });

      if (!conversation) {
        this.logger.error(`Conversation ${conversationId} not found`);
        return;
      }

      await this.storeMessagesForConversation(em, conversation, messages);
      await em.flush();
    } catch (error) {
      this.logger.error(
        `Failed to store messages: ${error instanceof Error ? error.message : String(error)}`,
      );
      throw error;
    }
  }

  private async storeMessagesForConversation(
    em: EntityManager,
    conversation: ConversationEntity,
    messages: Array<{
      externalMessageId: string;
      direction: "inbound" | "outbound";
      status: "sent" | "delivered" | "read" | "failed";
      text?: string;
      out: boolean;
      sentAt?: Date | null;
      platformData: Record<string, unknown>;
    }>,
  ): Promise<void> {
    let savedCount = 0;
    let skippedCount = 0;

    for (const messageData of messages) {
      try {
        const existingMessage = await em.findOne(MessageEntity, {
          externalMessageId: messageData.externalMessageId,
          conversationId: conversation.id,
        });

        if (existingMessage) {
          skippedCount++;
          continue;
        }

        const messageEntity = em.create(MessageEntity, {
          conversationId: conversation,
          externalMessageId: messageData.externalMessageId,
          direction: messageData.direction,
          status: messageData.status,
          role: "owner",
          text: messageData.text,
          out: messageData.out,
          sentAt: messageData.sentAt,
          provideOriginalPayload: messageData.platformData,
        });

        em.persist(messageEntity);
        savedCount++;
      } catch (error) {
        this.logger.error(
          `Failed to create message ${messageData.externalMessageId}: ${error instanceof Error ? error.message : String(error)}`,
        );
      }
    }

    this.logger.log(
      `Saved ${savedCount} messages for conversation ${conversation.externalId}, skipped ${skippedCount} existing messages`,
    );
  }
}
