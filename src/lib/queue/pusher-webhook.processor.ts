import { Processor, WorkerHost } from "@nestjs/bullmq";
import { Job } from "bullmq";
import {
  Injectable,
  Logger,
  NotFoundException,
  ForbiddenException,
  Inject,
} from "@nestjs/common";
import { InjectRepository } from "@mikro-orm/nestjs";
import { EntityRepository } from "@mikro-orm/core";
import { MessageService } from "@app/modules/message/message.service";
import { MessagingService } from "@app/lib/social-media-registry/messaging.service";
import { PusherService } from "@app/lib/pusher/pusher.service";
import { UtilsService } from "@app/common/utils.service";
import { CacheService } from "@app/common/cache/cache.service";
import { ApplicationConfiguration } from "@app/config/app.config";
import { UserSocialSessionEntity } from "@app/entities/user-social-session.entity";
import { ConversationEntity } from "@app/entities/conversation.entity";
import { SenderRole, SocialMediaPlatform } from "@app/types";
import {
  PusherReadMessageEvent,
  PusherSendMessageEvent,
} from "@app/lib/pusher/types";
import { PusherEvent } from "@app/lib/pusher/pusher.constants";
import { ok, fail } from "@app/common/response";
import { JobName, QueueName } from "./queue.constants";
import type { ConfigType } from "@nestjs/config";
import { UserEntity } from "@app/entities/user.entity";
import { OutboundMessageActorService } from "./outbound-message-actor.service";

export interface PusherSendMessageJobData {
  data: PusherSendMessageEvent;
  channel?: string;
  socketId?: string;
}

export interface PusherReadMessageJobData {
  data: PusherReadMessageEvent;
  channel?: string;
  socketId?: string;
}

type EmailConversationMetadata = {
  participants?: string[];
  senderEmail?: string;
};

@Processor(QueueName.PusherWebhooks, { concurrency: 20 })
@Injectable()
export class PusherWebhookProcessor extends WorkerHost {
  private readonly logger = new Logger(PusherWebhookProcessor.name);

  constructor(
    private readonly messageService: MessageService,
    private readonly messagingService: MessagingService,
    private readonly pusherService: PusherService,
    private readonly utilsService: UtilsService,
    private readonly cacheService: CacheService,
    private readonly outboundMessageActorService: OutboundMessageActorService,
    @Inject(ApplicationConfiguration.KEY)
    private readonly appConfig: ConfigType<typeof ApplicationConfiguration>,
    @InjectRepository(UserSocialSessionEntity)
    private readonly userSocialSessionRepository: EntityRepository<UserSocialSessionEntity>,
    @InjectRepository(ConversationEntity)
    private readonly conversationRepository: EntityRepository<ConversationEntity>,
    @InjectRepository(UserEntity)
    private readonly userRepository: EntityRepository<UserEntity>,
  ) {
    super();
  }

  async process(
    job: Job<PusherSendMessageJobData | PusherReadMessageJobData>,
  ): Promise<void> {
    if (job.name === JobName.ProcessPusherSendMessage) {
      await this.handleSendMessageEvent(job as Job<PusherSendMessageJobData>);
    } else if (job.name === JobName.ProcessPusherReadMessage) {
      await this.handleReadMessageEvent(job as Job<PusherReadMessageJobData>);
    }
  }

  private validateSuperAdminConfig(): string {
    const superAdminEmail = this.appConfig.superAdminEmail?.trim();

    if (!superAdminEmail) {
      this.logger.error(
        "Super admin email not configured in application config",
      );
      throw new NotFoundException("Super admin email not configured");
    }

    return superAdminEmail;
  }

  private async getSessionFromCache(
    platform: SocialMediaPlatform,
    originalUserId?: string,
  ): Promise<
    { sessionToken: string; userId: string; sentByUserId?: string } | undefined
  > {
    const cachedSession = await this.cacheService.getSessionToken(platform);

    if (!cachedSession?.sessionToken) {
      return undefined;
    }

    const cachedUser = await this.cacheService.getSuperAdmin();

    if (!cachedUser) {
      this.logger.warn(
        `Session token found in cache but super admin user not cached for platform: ${platform}`,
      );
      return undefined;
    }

    let userId = cachedUser.id;

    if (platform === SocialMediaPlatform.Telegram) {
      const match = cachedSession.sessionToken.match(/user_(.+)$/);
      if (match && match[1]) {
        userId = match[1];
        this.logger.debug(
          `Extracted userId ${userId} from Telegram session token`,
        );
      } else {
        this.logger.warn(
          `Could not extract userId from Telegram session token format`,
        );
      }
    }

    return {
      sessionToken: cachedSession.sessionToken,
      userId,
      sentByUserId:
        platform === SocialMediaPlatform.Email ? originalUserId : userId,
    };
  }

  private async getSessionFromDatabase(
    platform: SocialMediaPlatform,
    superAdminEmail: string,
  ): Promise<{ sessionToken: string; userId: string }> {
    const userSession = await this.userSocialSessionRepository.findOne(
      {
        platform: platform,
        user: { email: superAdminEmail },
      },
      { populate: ["user"] },
    );

    if (!userSession) {
      this.logger.error(
        `No session record found in database for super admin on platform: ${platform}`,
      );
      await this.cacheService.refreshSessionToken(platform);
      throw new NotFoundException(
        `No session record found for super admin on platform ${platform}`,
      );
    }

    if (
      !userSession.sessionToken &&
      platform === SocialMediaPlatform.Telegram
    ) {
      this.logger.error(
        `Session record exists but session token is null for platform: ${platform}`,
      );
      await this.cacheService.refreshSessionToken(platform);
      throw new ForbiddenException(
        `No session token available for super admin on platform ${platform}`,
      );
    }
    if (!userSession.accessToken && platform !== SocialMediaPlatform.Telegram) {
      this.logger.error(
        `Session record exists but access token is null for platform: ${platform}`,
      );
      await this.cacheService.refreshSessionToken(platform);
      throw new ForbiddenException(
        `No access token available for super admin on platform ${platform}`,
      );
    }

    const sessionToken =
      platform === SocialMediaPlatform.Telegram
        ? userSession.sessionToken!
        : userSession.accessToken!;
    const userId = userSession.user.id;

    await this.cacheService.updateSessionToken(platform, {
      platform: platform,
      sessionToken: sessionToken,
    });

    return { sessionToken, userId };
  }

  private async getOrFetchSession(
    platform: SocialMediaPlatform,
    superAdminEmail: string,
    originalUserId?: string,
  ): Promise<{
    sessionToken: string;
    userId: string;
    sentByUserId?: string;
  }> {
    const cachedSession = await this.getSessionFromCache(
      platform,
      originalUserId,
    );
    if (cachedSession) {
      return cachedSession;
    }

    const dbSession = await this.getSessionFromDatabase(
      platform,
      superAdminEmail,
    );
    return {
      ...dbSession,
      sentByUserId:
        platform === SocialMediaPlatform.Email ? originalUserId : dbSession.userId,
    };
  }

  private async resolveActorUserId(
    eventUserId?: string,
    socketId?: string,
  ): Promise<string | undefined> {
    if (socketId) {
      const cachedUserId =
        await this.cacheService.getPusherSocketUser(socketId);
      if (cachedUserId) {
        if (eventUserId && cachedUserId !== eventUserId) {
          this.logger.warn(
            `Pusher socket ${socketId} user mismatch: event ${eventUserId}, cached ${cachedUserId}`,
          );
        }
        return cachedUserId;
      }
    }

    return eventUserId;
  }

  private async resolveSenderRole(userId?: string): Promise<SenderRole> {
    if (!userId) {
      return "owner";
    }

    const user = await this.userRepository.findOne(
      { id: userId },
      { populate: ["role"] },
    );

    if (!user) {
      return "owner";
    }

    return user.role.name === "super-admin" ? "owner" : "pa";
  }

  private async handleSendMessageEvent(
    job: Job<PusherSendMessageJobData>,
  ): Promise<void> {
    this.logger.log("send message queue");
    const { data, channel, socketId } = job.data;
    let actorUserId: string | undefined;
    let accountId: string | undefined;

    try {
      const superAdminEmail = this.validateSuperAdminConfig();
      actorUserId = await this.resolveActorUserId(data.userId, socketId);
      const { sessionToken, userId, sentByUserId } =
        await this.getOrFetchSession(
          data.platform,
          superAdminEmail,
          actorUserId,
        );

      let providerChatId = data.chatId;

      if (data.platform === SocialMediaPlatform.Email) {
        const conversation = await this.conversationRepository.findOne({
          externalId: data.chatId,
          platform: data.platform,
        });

        if (!conversation) {
          throw new NotFoundException(
            `Conversation not found for chatId: ${data.chatId}`,
          );
        }

        accountId = conversation.accountId;
        const credentials =
          this.utilsService.decryptEmailCredentials(sessionToken);
        providerChatId = this.resolveEmailRecipients(
          conversation,
          credentials.email,
        );

        const trimmedSubject = data.subject?.trim();
        const hasSubject = Boolean(trimmedSubject);

        if (data.reply === true) {
          if (hasSubject) {
            this.logger.warn(
              "Email reply requested with subject provided; ignoring subject",
            );
          }
          data.subject = undefined;
        } else if (data.reply === false) {
          data.subject = trimmedSubject;
        } else if (hasSubject) {
          data.reply = false;
          data.subject = trimmedSubject;
        } else {
          data.reply = true;
          data.subject = undefined;
        }
      }

      const result = await this.messagingService.sendMessage({
        platform: data.platform,
        sessionToken: sessionToken,
        chatId: data.chatId,
        providerChatId,
        message: data.message,
        userId: userId,
        sentByUserId,
        fail: data.fail,
        subject: data.subject,
        html: data.html,
        reply: data.reply,
        ccRecipients: data.ccRecipients,
        bccRecipients: data.bccRecipients,
      });

      if (result.success) {
        if (
          data.platform === SocialMediaPlatform.Email &&
          accountId &&
          actorUserId &&
          result.messageId
        ) {
          const senderRole = await this.resolveSenderRole(actorUserId);
          await this.outboundMessageActorService.recordMapping({
            platform: data.platform,
            accountId,
            messageId: result.messageId,
            actorUserId,
            senderRole,
          });
        }

        if (channel) {
          const recentMessages =
            await this.messageService.getLastMessagesForConversation(
              data.platform,
              data.chatId,
              5,
            );

          await this.pusherService.trigger(
            channel,
            PusherEvent.MessageSent,
            ok("Message sent successfully", {
              messageId: result.messageId,
              platform: data.platform,
              chatId: data.chatId,
              messages: recentMessages,
            }),
            socketId ? { socketId } : undefined,
          );
        }
      } else {
        this.logger.error(
          `Failed to send message via Pusher trigger for ${data.platform}: ${result.error}`,
        );

        this.utilsService.reportError(result.error || "Unknown error", {
          tags: {
            platform: data.platform,
            chatId: data.chatId,
            errorType: "MESSAGE_SEND_FAILED",
          },
          extra: {
            userId: actorUserId ?? data.userId,
            tempId: data.tempId,
          },
        });

        if (channel) {
          await this.pusherService.trigger(
            channel,
            PusherEvent.MessageError,
            fail(
              "Failed to send message",
              {
                code: "MESSAGE_SEND_FAILED",
                details: {
                  error: result.error,
                  platform: data.platform,
                  chatId: data.chatId,
                },
              },
              {
                tempId: data.tempId,
              },
            ),
            socketId ? { socketId } : undefined,
          );
          this.logger.log(
            `Emitted message-error response to channel ${channel}`,
          );
        }
      }
    } catch (error) {
      this.logger.error(
        `Exception while handling Pusher send message event: ${error instanceof Error ? error.message : String(error)}`,
      );

      this.utilsService.reportError(
        error instanceof Error ? error : String(error),
        {
          tags: {
            platform: data.platform,
            chatId: data.chatId,
            errorType: "MESSAGE_SEND_EXCEPTION",
          },
          extra: {
            userId: actorUserId ?? data.userId,
            tempId: data.tempId,
          },
        },
      );

      if (channel) {
        await this.pusherService.trigger(
          channel,
          PusherEvent.MessageError,
          fail("Failed to send message", {
            code: "MESSAGE_SEND_EXCEPTION",
            details: {
              error: error instanceof Error ? error.message : String(error),
              platform: data.platform,
              chatId: data.chatId,
            },
          }),
          socketId ? { socketId } : undefined,
        );
      }

      throw error;
    }
  }

  private resolveEmailRecipients(
    conversation: ConversationEntity,
    accountEmail: string,
  ): string {
    const participants = conversation.participants ?? [];
    const metadata = conversation.platformData as
      | EmailConversationMetadata
      | undefined;
    const normalizedAccount = accountEmail.trim().toLowerCase();

    const recipients = new Set<string>();
    const addRecipient = (email: string) => {
      const normalized = email.trim().toLowerCase();
      if (normalized && normalized !== normalizedAccount) {
        recipients.add(normalized);
      }
    };

    for (const participant of participants) {
      this.extractEmailsFromString(participant).forEach((email) => {
        addRecipient(email);
      });
    }

    const metadataParticipants = metadata?.participants ?? [];
    for (const participant of metadataParticipants) {
      this.extractEmailsFromString(participant).forEach((email) => {
        addRecipient(email);
      });
    }

    if (metadata?.senderEmail) {
      this.extractEmailsFromString(metadata.senderEmail).forEach((email) => {
        addRecipient(email);
      });
    }

    if (recipients.size === 0) {
      throw new NotFoundException(
        `No recipients defined for email conversation ${conversation.externalId}`,
      );
    }

    return Array.from(recipients).join(", ");
  }

  private extractEmailsFromString(value?: string): string[] {
    if (!value) {
      return [];
    }

    const matches = value.match(/[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}/gi);
    if (!matches) {
      return [];
    }

    return matches.map((email) => email.toLowerCase());
  }

  private async handleReadMessageEvent(
    job: Job<PusherReadMessageJobData>,
  ): Promise<void> {
    const { data, channel, socketId } = job.data;

    try {
      const result = await this.messageService.updateMessageStatus(data);

      if (result.success && channel) {
        await this.pusherService.trigger(
          channel,
          PusherEvent.MessageRead,
          ok("Messages marked as read", {
            platform: data.platform,
            chatId: data.chatId,
            messages: result.messages,
          }),
          socketId ? { socketId } : undefined,
        );
      } else if (!result.success && channel) {
        await this.pusherService.trigger(
          channel,
          PusherEvent.MessageError,
          fail("Failed to mark messages as read", {
            code: "MESSAGE_READ_FAILED",
            details: {
              error: result.error,
              platform: data.platform,
              chatId: data.chatId,
              failedMessageIds: result.failedMessageIds,
              messages: result.messages,
            },
          }),
          socketId ? { socketId } : undefined,
        );
      }
    } catch (error) {
      this.logger.error(
        `Exception while handling Pusher read message event: ${error instanceof Error ? error.message : String(error)}`,
      );

      if (channel) {
        const recentMessages =
          await this.messageService.getLastMessagesForConversation(
            data.platform,
            data.chatId,
            5,
          );

        await this.pusherService.trigger(
          channel,
          PusherEvent.MessageError,
          fail("Failed to mark messages as read", {
            code: "MESSAGE_READ_EXCEPTION",
            details: {
              error: error instanceof Error ? error.message : String(error),
              platform: data.platform,
              chatId: data.chatId,
              failedMessageIds: data.data.map((m) => m.messageId),
              messages: recentMessages,
            },
          }),
          socketId ? { socketId } : undefined,
        );
      }

      throw error;
    }
  }

}
