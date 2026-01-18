/* eslint-disable @typescript-eslint/no-unused-vars */
import { Inject, Injectable, Logger, OnModuleInit } from "@nestjs/common";
import {
  ProviderDriver,
  PollResult,
  PollCursor,
  SendMessageParams,
  SendMessageResult,
} from "../../provider.interface";
import { SocialMediaPlatform } from "@app/types";
import { ProviderRegistry } from "../../provider.registry";
import { TwitterApi } from "twitter-api-v2";
import { ConfigType } from "@nestjs/config";
import { XAPIConfiguration } from "@app/config/x.config";
import { InjectRepository } from "@mikro-orm/nestjs";
import { EntityManager, EntityRepository } from "@mikro-orm/core";
import { UserSocialSessionEntity } from "@app/entities/user-social-session.entity";
import { ConnectedAccountsEntity } from "@app/entities/connected-accounts.entity";
import { UserEntity } from "@app/entities/user.entity";
import { InjectQueue } from "@nestjs/bullmq";
import { Queue } from "bullmq";
import type { ConnectorJobData } from "@app/lib/queue/connector.processor";
import { XApi } from "./api";
import {
  XRateLimiterService,
  XRateLimitEndpoint,
} from "./x-rate-limiter.service";
import { ConversationEntity } from "@app/entities/conversation.entity";

@Injectable()
export class XProvider implements ProviderDriver, OnModuleInit {
  readonly key = SocialMediaPlatform.X;
  private readonly logger = new Logger(XProvider.name);

  constructor(
    private readonly drivers: ProviderRegistry,
    @Inject(XAPIConfiguration.KEY)
    private readonly xConfig: ConfigType<typeof XAPIConfiguration>,
    @InjectRepository(UserSocialSessionEntity)
    private readonly sessionRepo: EntityRepository<UserSocialSessionEntity>,
    @InjectRepository(ConnectedAccountsEntity)
    private readonly connectedAccountsRepo: EntityRepository<ConnectedAccountsEntity>,
    @InjectRepository(UserEntity)
    private readonly userRepo: EntityRepository<UserEntity>,
    @InjectRepository(ConversationEntity)
    private readonly conversationRepo: EntityRepository<ConversationEntity>,
    private readonly em: EntityManager,
    @InjectQueue("platform-connection")
    private readonly platformConnectionQueue: Queue<ConnectorJobData>,
    private readonly rateLimiter: XRateLimiterService,
  ) {
    this.drivers.register(this);
  }

  onModuleInit() {
    this.logger.log("X Provider initialized");
  }

  async validateCredentials(token: string): Promise<void> {
    try {
      const client = new TwitterApi(token);
      await client.v2.me();
      this.logger.log("X credentials validated successfully");
    } catch (error) {
      this.logger.error("Failed to validate X credentials", error);
      throw new Error("Invalid X credentials");
    }
  }

  async poll(account: {
    id: string;
    accessToken: string;
    cursor: PollCursor;
  }): Promise<PollResult> {
    try {
      const userId = await this.getUserIdFromAccount(account.id);
      if (!userId) {
        this.logger.warn(`Account ${account.id} has no user ID, skipping poll`);
        return {
          messages: [],
          nextCursor: account.cursor,
          backoffMs: 60000,
        };
      }

      const accessToken = await this.ensureValidToken(userId, account.accessToken);

      const rateLimitBackoff = await this.checkRateLimits(userId, account.id, account.cursor);
      if (rateLimitBackoff) {
        return rateLimitBackoff;
      }

      const sinceId = account.cursor?.since_id as string | undefined;
      const dmEventsResponse = await this.fetchDirectMessages(accessToken, userId, sinceId);

      await this.rateLimiter.incrementPollCounter(userId);

      const messages = dmEventsResponse.data.map((event) =>
        this.transformDmEvent(event)
      );

      const nextCursor: PollCursor =
        dmEventsResponse.data.length > 0
          ? {
              since_id:
                dmEventsResponse.data[dmEventsResponse.data.length - 1]?.id,
            }
          : account.cursor;

      return {
        messages,
        nextCursor,
        backoffMs: undefined,
      };
    } catch (error) {
      return this.handlePollError(error, account.id, account.accessToken, account.cursor);
    }
  }

  private async getUserIdFromAccount(accountId: string): Promise<string | undefined> {
    const connectedAccount = await this.connectedAccountsRepo.findOne(
      { id: accountId },
      { populate: ["user"] },
    );
    return typeof connectedAccount?.user === "object"
      ? connectedAccount.user.id
      : connectedAccount?.user;
  }

  private async ensureValidToken(userId: string, currentToken: string): Promise<string> {
    try {
      const { accessToken: refreshedToken, refreshed } =
        await this.refreshTokenIfNeeded(userId);
      if (refreshed) {
        this.logger.log(
          `Token was refreshed for polling user ${userId}, updating connected account`,
        );
        return refreshedToken;
      }
    } catch (error) {
      this.logger.error(
        `Failed to refresh token for polling user ${userId}`,
        error,
      );
    }
    return currentToken;
  }

  private async checkRateLimits(
    userId: string,
    accountId: string,
    cursor: PollCursor,
  ): Promise<PollResult | null> {
    const rateLimitCheck = await this.rateLimiter.checkPollLimit(userId);
    if (!rateLimitCheck.allowed) {
      this.logger.warn(
        `Account ${accountId}: ${rateLimitCheck.reason}. Reset at ${rateLimitCheck.resetAt?.toISOString()}`,
      );
      return {
        messages: [],
        nextCursor: cursor,
        backoffMs: rateLimitCheck.retryAfterMs,
      };
    }

    const api = new XApi(await this.ensureValidToken(userId, ""), this.rateLimiter, userId);
    const backoffMs = await api.getBackoffMs();
    if (backoffMs && backoffMs > 0) {
      this.logger.warn(
        `Account ${accountId} hit 24-hour rate limit. Backing off for ${this.formatBackoffTime(backoffMs)}`,
      );
      return {
        messages: [],
        nextCursor: cursor,
        backoffMs,
      };
    }

    return null;
  }

  private async fetchDirectMessages(accessToken: string, userId: string, sinceId?: string) {
    const api = new XApi(accessToken, this.rateLimiter, userId);
    return api.directMessages.listEvents({
      max_results: 50,
      ...(sinceId && { since_id: sinceId }),
    });
  }

  private transformDmEvent(event: any) {
    const text =
      event.event_type === "MessageCreate" ? event.text : undefined;

    return {
      externalMessageId: event.id,
      conversationExternalId: event.dm_conversation_id || event.id,
      sentAt: event.created_at,
      senderHandle: event.sender_id,
      text,
      attachments: event.attachments?.media_keys?.map((key: string) => ({
        kind: "media",
        url: key,
        mime: undefined,
        size: undefined,
        durationMs: undefined,
      })),
      raw: this.toSafeJson(event),
    };
  }

  private async handlePollError(
    error: unknown,
    accountId: string,
    accessToken: string,
    cursor: PollCursor,
  ): Promise<PollResult> {
    this.logger.error(
      `Failed to poll X DMs for account ${accountId}`,
      error,
    );

    try {
      const userId = await this.getUserIdFromAccount(accountId);
      if (userId) {
        if (error instanceof Error && error.message.includes("429")) {
          await this.rateLimiter.handle429Response(
            userId,
            XRateLimitEndpoint.DM_EVENTS,
          );
        }

        const api = new XApi(accessToken, this.rateLimiter, userId);
        const backoffMs = await api.getBackoffMs();
        if (backoffMs && backoffMs > 0) {
          this.logger.warn(
            `Returning 24-hour rate limit backoff: ${this.formatBackoffTime(backoffMs)}`,
          );
          return {
            messages: [],
            nextCursor: cursor,
            backoffMs,
          };
        }
      }
    } catch (backoffError) {
      this.logger.debug("Could not determine backoff time, using default");
    }

    return {
      messages: [],
      nextCursor: cursor,
      backoffMs: 60000,
    };
  }

  private formatBackoffTime(backoffMs: number): string {
    const backoffHours = Math.floor(backoffMs / 3600000);
    const backoffMinutes = Math.floor((backoffMs % 3600000) / 60000);
    return `~${backoffHours}h ${backoffMinutes}m`;
  }

  async sendMessage(params: SendMessageParams): Promise<SendMessageResult> {
    const { sessionToken, chatId, message, userId } = params;
    try {
      if (!userId) {
        return {
          success: false,
          error: "Please provide a valid user ID to send messages",
        };
      }

      const rateLimitCheck = await this.rateLimiter.checkSendLimit(userId);
      if (!rateLimitCheck.allowed) {
        this.logger.warn(
          `Send rate limit exceeded for user ${userId}: ${rateLimitCheck.reason}. Reset at ${rateLimitCheck.resetAt?.toISOString()}`,
        );
        return {
          success: false,
          error: `${rateLimitCheck.reason}. Try again at ${rateLimitCheck.resetAt?.toISOString()}`,
        };
      }

      let accessToken = sessionToken;
      if (userId) {
        try {
          const { accessToken: refreshedToken, refreshed } =
            await this.refreshTokenIfNeeded(userId);
          if (refreshed) {
            this.logger.log(
              `Token was refreshed for sending message by user ${userId}`,
            );
            accessToken = refreshedToken;
          }
        } catch (error) {
          this.logger.error(
            `Failed to refresh token for sending message by user ${userId}`,
            error,
          );
          return {
            success: false,
            error:
              error instanceof Error
                ? error.message
                : "Failed to refresh X access token",
          };
        }
      }

      const api = new XApi(accessToken, this.rateLimiter, userId);

      const targetConversation = await this.conversationRepo.findOne({
        externalId: chatId,
      });
      if (!targetConversation) {
        return {
          success: false,
          error: `Conversation with ID ${chatId} not found`,
        };
      }
      const platformData = targetConversation.platformData as {
        participantId: string;
        conversationId: string;
      };

      const result = await api.directMessages.sendToParticipant(
        platformData.participantId,
        {
          text: message,
        },
      );

      await this.rateLimiter.incrementSendCounter(userId);

      this.logger.log(
        `Successfully sent DM to ${chatId}, event_id: ${result.data.dm_event_id}`,
      );

      return {
        success: true,
        messageId: result.data.dm_event_id,
      };
    } catch (error) {
      this.logger.error(`Failed to send X DM to ${chatId}`, error);

      if (userId && error instanceof Error && error.message.includes("429")) {
        await this.rateLimiter.handle429Response(
          userId,
          XRateLimitEndpoint.SEND_MESSAGE,
        );
        return {
          success: false,
          error: "Rate limit exceeded. Please try again later.",
        };
      }

      return {
        success: false,
        error:
          error instanceof Error ? error.message : "Failed to send X message",
      };
    }
  }

  async updateMessageStatus(params: unknown): Promise<boolean> {
    this.logger.debug("X updateMessageStatus called (no-op)");
    return true;
  }

  async fetchAndStoreConversations(
    userId: string,
    accessToken: string,
  ): Promise<void> {
    this.ensureProviderRegistered();

    const token = await this.ensureValidToken(userId, accessToken);
    const api = new XApi(token, this.rateLimiter, userId);
    const em = this.em.fork();

    try {
      const connectedAccount = await this.validateUserAndAccount(em, userId);
      if (!connectedAccount) return;

      this.logger.log(`Fetching X DM conversations for user ${userId}`);
      const dmEventsResponse = await api.directMessages.listEvents({
        max_results: 20,
      });

      const meResponse = await api.users.me();
      const conversationsMap = this.buildConversationsMap(
        dmEventsResponse.data,
        meResponse.data.id,
      );

      const conversationsData = await this.processConversations(
        api,
        conversationsMap,
      );

      await this.enqueueConversations(
        conversationsData,
        userId,
        connectedAccount.id,
      );

      this.logger.log(
        `Enqueued ${conversationsData.length} X conversations for storage for user ${userId}`,
      );
    } catch (error) {
      this.logger.error("Failed to fetch and store X conversations", error);
      throw error;
    }
  }

  private ensureProviderRegistered(): void {
    try {
      this.drivers.get(this.key);
    } catch {
      this.logger.warn("Registering X provider in registry");
      this.drivers.register(this);
    }
  }

  private async validateUserAndAccount(em: EntityManager, userId: string) {
    const user = await em.findOne(UserEntity, { id: userId });
    if (!user) {
      this.logger.error(`User ${userId} not found`);
      return null;
    }

    const connectedAccount = await em.findOne(ConnectedAccountsEntity, {
      user: userId,
      platform: SocialMediaPlatform.X,
    });

    if (!connectedAccount) {
      this.logger.error(`No connected account found for user ${userId} on X`);
      return null;
    }

    return connectedAccount;
  }

  private buildConversationsMap(dmEvents: any[], myUserId: string) {
    const conversationsMap = new Map<
      string,
      {
        conversationId: string;
        participantId: string;
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
    >();

    for (const event of dmEvents) {
      if (event.event_type !== "MessageCreate") continue;

      const conversationId = event.dm_conversation_id || event.id;
      const senderId = event.sender_id || "unknown";
      const isOutgoing = senderId === myUserId;

      const participantId =
        (isOutgoing
          ? event.participant_ids?.find((id: string) => id !== myUserId)
          : senderId) || senderId;

      if (!conversationsMap.has(conversationId)) {
        conversationsMap.set(conversationId, {
          conversationId,
          participantId,
          messages: [],
        });
      }

      const conversation = conversationsMap.get(conversationId)!;
      conversation.messages.push({
        externalMessageId: event.id,
        direction: isOutgoing ? "outbound" : "inbound",
        status: "delivered",
        text: event.text,
        out: isOutgoing,
        sentAt: event.created_at ? new Date(event.created_at) : null,
        platformData: this.toSafeJson(event) as Record<string, unknown>,
      });
    }

    return conversationsMap;
  }

  private async processConversations(api: XApi, conversationsMap: Map<string, any>) {
    const conversationsData: Array<{
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
    }> = [];

    for (const [conversationId, conversationInfo] of conversationsMap) {
      try {
        const conversationName = await this.getParticipantName(
          api,
          conversationInfo.participantId,
          conversationId,
        );

        const sortedMessages = conversationInfo.messages.sort((a: any, b: any) => {
          const aTime = a.sentAt?.getTime() || 0;
          const bTime = b.sentAt?.getTime() || 0;
          return bTime - aTime;
        });

        conversationsData.push({
          externalId: conversationId,
          name: conversationName,
          unreadCount: 0,
          platformData: this.toSafeJson({
            conversationId,
            participantId: conversationInfo.participantId,
          }) as Record<string, unknown>,
          messages: sortedMessages,
          lastMessageText: sortedMessages[0]?.text,
        });
      } catch (error) {
        this.logger.error(
          `Failed to process conversation ${conversationId}: ${error instanceof Error ? error.message : String(error)}`,
        );
      }
    }

    return conversationsData;
  }

  private async getParticipantName(
    api: XApi,
    participantId: string,
    fallback: string,
  ): Promise<string> {
    try {
      const participantResponse = await api.users.getById(participantId);
      return (
        participantResponse.data.name || participantResponse.data.username
      );
    } catch (error) {
      this.logger.warn(
        `Failed to fetch participant info for ${participantId}: ${error instanceof Error ? error.message : String(error)}`,
      );
      return fallback;
    }
  }

  private async enqueueConversations(
    conversations: any[],
    userId: string,
    accountId: string,
  ): Promise<void> {
    await this.platformConnectionQueue.add(
      "store-conversations",
      {
        type: "conversations",
        platform: SocialMediaPlatform.X,
        userId,
        accountId,
        conversations,
      },
      {
        attempts: 3,
        backoff: {
          type: "exponential",
          delay: 1000,
        },
      },
    );
  }

  private toSafeJson<T>(payload: T): unknown {
    try {
      return JSON.parse(JSON.stringify(payload));
    } catch (error) {
      this.logger.warn("Failed to serialize payload to JSON", error);
      return payload;
    }
  }

  private async refreshTokenIfNeeded(
    userId: string,
  ): Promise<{ accessToken: string; refreshed: boolean }> {
    const session = await this.sessionRepo.findOne({
      user: { id: userId },
      platform: SocialMediaPlatform.X,
    });

    if (!session || !session.accessToken) {
      throw new Error("No X session or access token found");
    }

    const now = new Date();
    const bufferMs = 5 * 60 * 1000;
    const needsRefresh =
      !session.expiresAt ||
      session.expiresAt.getTime() - now.getTime() < bufferMs;

    if (!needsRefresh) {
      this.logger.debug(
        `X token for user ${userId} is still valid until ${session.expiresAt?.toISOString()}`,
      );
      return { accessToken: session.accessToken, refreshed: false };
    }

    if (!session.refreshToken) {
      this.logger.error(
        `X token expired for user ${userId} but no refresh token available`,
      );
      throw new Error(
        "X access token expired and no refresh token available. Please reconnect your X account.",
      );
    }

    this.logger.log(`Refreshing X token for user ${userId}`);

    try {
      const client = new TwitterApi({
        clientId: this.xConfig.X_OAUTH_CLIENT_ID,
        clientSecret: this.xConfig.X_OAUTH_CLIENT_SECRET,
      });

      const {
        client: refreshedClient,
        accessToken: newAccessToken,
        refreshToken: newRefreshToken,
        expiresIn,
      } = await client.refreshOAuth2Token(session.refreshToken);

      await refreshedClient.v2.me();

      const em = this.sessionRepo.getEntityManager();
      session.accessToken = newAccessToken;
      session.refreshToken = newRefreshToken ?? session.refreshToken;
      session.expiresAt = expiresIn
        ? new Date(Date.now() + expiresIn * 1000)
        : undefined;

      em.persist(session);
      await em.flush();

      this.logger.log(
        `Successfully refreshed X token for user ${userId}, new expiry: ${session.expiresAt?.toISOString()}`,
      );

      return { accessToken: newAccessToken, refreshed: true };
    } catch (error) {
      this.logger.error(
        `Failed to refresh X token for user ${userId}`,
        error instanceof Error ? error.stack : error,
      );
      throw new Error("Failed to refresh X access token");
    }
  }
}
