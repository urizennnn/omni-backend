import { Processor, WorkerHost, InjectQueue } from "@nestjs/bullmq";
import { Job, Queue } from "bullmq";
import { Injectable, Logger } from "@nestjs/common";
import { InjectRepository } from "@mikro-orm/nestjs";
import { EntityManager, EntityRepository, QueryOrder } from "@mikro-orm/core";
import { ConnectedAccountsEntity } from "@app/entities/connected-accounts.entity";
import { ProviderRegistry } from "../social-media-registry/provider.registry";
import {
  PollCursor,
  PollResult,
  ProviderDriver,
} from "../social-media-registry/provider.interface";
import { UserSocialSessionEntity } from "@app/entities/user-social-session.entity";
import { UtilsService } from "@app/common/utils.service";
import { SocialMediaPlatform } from "@app/types";
import { PusherService } from "@app/lib/pusher/pusher.service";
import { PusherChannel, PusherEvent } from "@app/lib/pusher/pusher.constants";
import { SaveMessageJobData } from "./message.processor";
import { MessageEntity } from "@app/entities/messages.entity";
import { ConversationEntity } from "@app/entities/conversation.entity";
import { ok } from "@app/common/response";
import { QueueName, JobName } from "./queue.constants";

export interface PollJobData {
  accountId: string;
  platform: string;
}

@Processor(QueueName.SocialMediaPoll, {
  concurrency: 5,
})
@Injectable()
export class PollProcessor extends WorkerHost {
  private readonly logger = new Logger(PollProcessor.name);

  constructor(
    @InjectRepository(ConnectedAccountsEntity)
    private readonly accountRepo: EntityRepository<ConnectedAccountsEntity>,
    @InjectRepository(MessageEntity)
    private readonly messageRepo: EntityRepository<MessageEntity>,
    @InjectRepository(ConversationEntity)
    private readonly conversationRepo: EntityRepository<ConversationEntity>,
    @InjectQueue(QueueName.Messages)
    private readonly messagesQueue: Queue<SaveMessageJobData>,
    private readonly drivers: ProviderRegistry,
    private readonly utils: UtilsService,
    private readonly em: EntityManager,
    private readonly pusherService: PusherService,
  ) {
    super();
  }

  async process(job: Job<PollJobData>): Promise<void> {
    const { accountId, platform } = job.data;

    const fork = this.em.fork();

    try {
      const account = await this.loadAccount(fork, accountId);
      if (!account || account.status !== "active") {
        return;
      }

      const sessionToken = await this.resolveSessionToken(fork, account);
      if (!sessionToken) {
        return;
      }

      const driver = this.resolveDriver(platform);
      if (!driver) {
        return;
      }

      const result = await this.performPoll(driver, account, sessionToken);
      const messages = this.normalizePolledMessages(result);

      await this.updateAccountAfterPoll(fork, account, result.nextCursor);
      await this.handlePolledMessages(fork, account, messages);
      this.handleBackoff(result.backoffMs);
    } catch (error) {
      this.logger.error(
        `Failed to poll account ${accountId}: ${error instanceof Error ? error.message : String(error)}`,
      );
      throw error;
    }
  }

  private async loadAccount(
    fork: EntityManager,
    accountId: string,
  ): Promise<ConnectedAccountsEntity | null> {
    const account = await fork.findOne(
      ConnectedAccountsEntity,
      { id: accountId },
      { populate: ["user"] },
    );

    if (!account) {
      this.logger.warn(`Account ${accountId} not found, skipping poll`);
    }

    return account;
  }

  private async resolveSessionToken(
    fork: EntityManager,
    account: ConnectedAccountsEntity,
  ): Promise<string | null> {
    const socialSession = await fork.findOne(UserSocialSessionEntity, {
      platform: account.platform,
      user: account.user.id,
    });

    if (!socialSession) {
      this.logger.warn(
        `Account ${account.id} has no valid session, skipping poll`,
      );
      return null;
    }

    if (socialSession.accessToken) {
      return socialSession.accessToken;
    }

    if (
      account.platform === SocialMediaPlatform.Telegram &&
      socialSession.sessionToken !== null &&
      socialSession.sessionToken !== undefined
    ) {
      return socialSession.sessionToken;
    }

    this.logger.warn(
      `Account ${account.id} has no valid session, skipping poll`,
    );
    return null;
  }

  private resolveDriver(platform: string): ProviderDriver | null {
    try {
      return this.drivers.get(platform);
    } catch (error) {
      this.logger.error(
        `Driver for platform ${platform} not found: ${error instanceof Error ? error.message : String(error)}`,
      );
      return null;
    }
  }

  private async performPoll(
    driver: ProviderDriver,
    account: ConnectedAccountsEntity,
    accessToken: string,
  ): Promise<PollResult> {
    const cursor: PollCursor = account.cursor || null;
    return driver.poll({
      id: account.id,
      accessToken,
      cursor,
    });
  }

  private async updateAccountAfterPoll(
    fork: EntityManager,
    account: ConnectedAccountsEntity,
    nextCursor: PollCursor,
  ): Promise<void> {
    account.cursor = nextCursor;
    account.lastPolledAt = new Date();
    await fork.persistAndFlush(account);
  }

  private async handlePolledMessages(
    fork: EntityManager,
    account: ConnectedAccountsEntity,
    messages: PollResult["messages"],
  ): Promise<void> {
    if (!messages.length) {
      return;
    }

    for (const message of messages) {
      await this.handleSingleMessage(fork, account, message);
    }
  }

  private async handleSingleMessage(
    fork: EntityManager,
    account: ConnectedAccountsEntity,
    message: PollResult["messages"][number],
  ): Promise<void> {
    try {
      const existingMessage = await fork.findOne(MessageEntity, {
        externalMessageId: message.externalMessageId,
      });

      await this.messagesQueue.add(JobName.SaveMessage, {
        message,
        accountId: account.id,
        platform: account.platform,
        userId: account.user.id,
      });

      if (existingMessage) {
        return;
      }

      const recentMessages = await this.getLastMessagesForConversation(
        account.platform,
        message.conversationExternalId || "",
        5,
      );

      await this.pusherService.trigger(
        PusherChannel.PrivateMessaging,
        PusherEvent.Inbound,
        ok("Message received", {
          message: {
            externalMessageId: message.externalMessageId,
            conversationExternalId: message.conversationExternalId,
            text: message.text,
            sentAt: message.sentAt,
            senderHandle: message.senderHandle,
          },
          platform: account.platform,
          accountId: account.id,
          messages: recentMessages,
        }),
      );
    } catch (error) {
      this.logger.error(
        `Failed to queue message ${message.externalMessageId}: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }

  private handleBackoff(backoffMs?: number): void {
    if (backoffMs && backoffMs > 0) {
      throw new Error(`Backoff requested: ${backoffMs}ms`);
    }
  }

  private normalizePolledMessages(result: PollResult): PollResult["messages"] {
    if (result.platform !== SocialMediaPlatform.Email) {
      return result.messages;
    }

    const maybeNested = result.messages as unknown[];
    if (maybeNested.length === 0) {
      return result.messages;
    }

    if (Array.isArray(maybeNested[0])) {
      const flattened = (maybeNested as PollResult["messages"][]).flat();
      return this.dedupeEmailMessages(this.sortEmailMessagesBySentAt(flattened));
    }

    return this.dedupeEmailMessages(
      this.sortEmailMessagesBySentAt(result.messages),
    );
  }

  private sortEmailMessagesBySentAt(
    messages: PollResult["messages"],
  ): PollResult["messages"] {
    if (messages.length <= 1) {
      return messages;
    }

    return [...messages].sort((a, b) => {
      const aTime = this.parseSentAt(a.sentAt);
      const bTime = this.parseSentAt(b.sentAt);
      if (aTime !== bTime) {
        return aTime - bTime;
      }
      return (a.externalMessageId || "").localeCompare(
        b.externalMessageId || "",
      );
    });
  }

  private dedupeEmailMessages(
    messages: PollResult["messages"],
  ): PollResult["messages"] {
    if (messages.length <= 1) {
      return messages;
    }

    const seen = new Set<string>();
    const deduped: PollResult["messages"] = [];

    for (const message of messages) {
      const key = message.externalMessageId || message.messageId || "";
      if (key && seen.has(key)) {
        continue;
      }
      if (key) {
        seen.add(key);
      }
      deduped.push(message);
    }

    return deduped;
  }

  private parseSentAt(value?: string): number {
    if (!value) {
      return 0;
    }
    const parsed = Date.parse(value);
    return Number.isFinite(parsed) ? parsed : 0;
  }

  private async getLastMessagesForConversation(
    platform: SocialMediaPlatform,
    chatId: string,
    limit: number = 5,
  ) {
    try {
      const conversation = await this.conversationRepo.findOne(
        { externalId: chatId, platform },
        { populate: ["messages"] },
      );

      if (!conversation) {
        return [];
      }

      const messages = await this.messageRepo.find(
        { conversationId: conversation.id },
        { orderBy: { createdAt: QueryOrder.DESC }, limit },
      );

      return messages.map((msg) => ({
        id: msg.id,
        externalMessageId: msg.externalMessageId,
        direction: msg.direction,
        status: msg.status,
        role: msg.role,
        text: msg.text,
        out: msg.out,
        provideOriginalPayload: msg.provideOriginalPayload,
        createdAt: msg.createdAt,
        updatedAt: msg.updatedAt,
      }));
    } catch (error) {
      this.logger.error(
        `Failed to fetch recent messages: ${error instanceof Error ? error.message : String(error)}`,
      );
      return [];
    }
  }
}
