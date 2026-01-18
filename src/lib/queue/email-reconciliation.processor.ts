import { Processor, WorkerHost, InjectQueue } from "@nestjs/bullmq";
import { Injectable, Logger, Inject } from "@nestjs/common";
import { Job, Queue } from "bullmq";
import { InjectRepository } from "@mikro-orm/nestjs";
import { EntityRepository, QueryOrder } from "@mikro-orm/core";
import { ConnectedAccountsEntity } from "@app/entities/connected-accounts.entity";
import { UserSocialSessionEntity } from "@app/entities/user-social-session.entity";
import { MessageEntity } from "@app/entities/messages.entity";
import { SocialMediaPlatform } from "@app/types";
import { QueueName, JobName } from "./queue.constants";
import { EmailConnectionManager } from "@app/lib/social-media-registry/providers/email/email-connection.manager";
import { UtilsService } from "@app/common/utils.service";
import { EmailProvider } from "@app/lib/social-media-registry/providers/email/email.provider";
import { SaveMessageJobData } from "./message.processor";
import { ConfigType } from "@nestjs/config";
import { EmailConfiguration } from "@app/config/email.config";

export interface EmailReconciliationJobData {
  accountId: string;
}

@Processor(QueueName.EmailReconciliation, {
  concurrency: 2,
})
@Injectable()
export class EmailReconciliationProcessor extends WorkerHost {
  private readonly logger = new Logger(EmailReconciliationProcessor.name);
  private readonly remoteWindowSize: number;
  private readonly localLookback: number;

  constructor(
    @InjectRepository(ConnectedAccountsEntity)
    private readonly accountRepo: EntityRepository<ConnectedAccountsEntity>,
    @InjectRepository(UserSocialSessionEntity)
    private readonly sessionRepo: EntityRepository<UserSocialSessionEntity>,
    @InjectRepository(MessageEntity)
    private readonly messageRepo: EntityRepository<MessageEntity>,
    private readonly connectionManager: EmailConnectionManager,
    private readonly utilsService: UtilsService,
    private readonly emailProvider: EmailProvider,
    @InjectQueue(QueueName.Messages)
    private readonly messagesQueue: Queue<SaveMessageJobData>,
    @Inject(EmailConfiguration.KEY)
    private readonly emailConfig: ConfigType<typeof EmailConfiguration>,
  ) {
    super();
    this.remoteWindowSize =
      this.emailConfig.reconciliation.remoteWindowSize ?? 500;
    this.localLookback =
      this.emailConfig.reconciliation.localLookback ??
      this.remoteWindowSize * 2;
  }

  async process(job: Job<EmailReconciliationJobData>): Promise<void> {
    const { accountId } = job.data;

    try {
      const account = await this.accountRepo.findOne(
        { id: accountId },
        { populate: ["user"] },
      );

      if (!account) {
        this.logger.warn(
          `Account ${accountId} not found for reconciliation, skipping`,
        );
        return;
      }

      if (
        account.platform !== SocialMediaPlatform.Email ||
        account.status !== "active"
      ) {
        this.logger.debug(
          `Account ${accountId} not eligible for email reconciliation`,
        );
        return;
      }

      const session = await this.sessionRepo.findOne({
        user: account.user.id,
        platform: SocialMediaPlatform.Email,
      });

      if (!session?.accessToken) {
        this.logger.warn(
          `Account ${accountId} has no email credentials, skipping reconciliation`,
        );
        return;
      }

      const credentials = this.utilsService.decryptEmailCredentials(
        session.accessToken,
      );

      const client = await this.connectionManager.getOrCreateConnection(
        account.id,
        {
          host: credentials.imapHost,
          port: credentials.imapPort,
          secure: credentials.imapSecure,
          auth: {
            user: credentials.email,
            pass: credentials.imapPassword,
          },
        },
      );

      const mailbox = await client.mailboxOpen("INBOX");

      const unseenSearchResult = await client.search(
        { seen: false },
        { uid: true },
      );
      const unseenUids = Array.isArray(unseenSearchResult)
        ? unseenSearchResult
        : [];
      this.logger.log(
        `Unseen messages: ${unseenUids.length} UIDs`,
        `EmailReconciliation:${accountId}`,
      );

      const remoteUids = await client.search({ all: true }, { uid: true });

      if (!remoteUids || remoteUids.length === 0) {
        this.logger.debug(`No remote messages found for account ${account.id}`);
        return;
      }

      const candidateRemoteUids = remoteUids
        .sort((a, b) => b - a)
        .slice(0, this.remoteWindowSize);

      const localUids = await this.getRecentLocalUids(account.id);
      const missingUids = candidateRemoteUids
        .filter((uid) => !localUids.has(uid))
        .sort((a, b) => a - b);

      const unseenInDb = unseenUids.filter((uid) => localUids.has(uid));
      if (unseenInDb.length > 0) {
        try {
          await client.messageFlagsAdd(unseenInDb, ["\\Seen"], { uid: true });
          this.logger.log(
            `Marked ${unseenInDb.length} existing messages as seen for account ${account.id}`,
          );
        } catch (flagError) {
          this.logger.warn(
            `Failed to mark existing unseen messages as seen for account ${account.id}`,
            flagError,
          );
        }
      }

      if (missingUids.length === 0) {
        this.logger.debug(
          `Account ${account.id} is in sync (mailbox has ${mailbox.exists} messages)`,
        );
        return;
      }

      this.logger.warn(
        `Account ${account.id} missing ${missingUids.length} messages, attempting recovery`,
      );

      const recoveredMessages = await this.emailProvider.fetchMessagesByUid(
        account.id,
        session.accessToken,
        missingUids,
      );

      for (const message of recoveredMessages) {
        await this.messagesQueue.add(
          JobName.SaveMessage,
          {
            message,
            accountId: account.id,
            platform: account.platform,
            userId: account.user.id,
          },
          {
            removeOnFail: true,
            removeOnComplete: true,
          },
        );
      }

      this.logger.log(
        `Queued ${recoveredMessages.length} recovered messages for account ${account.id}`,
      );
    } catch (error) {
      this.logger.error(
        `Failed to reconcile email account ${accountId}: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
      throw error;
    }
  }

  private async getRecentLocalUids(accountId: string): Promise<Set<number>> {
    const messages = await this.messageRepo.find(
      {
        conversationId: {
          accountId,
          platform: SocialMediaPlatform.Email,
        },
      },
      {
        fields: ["provideOriginalPayload", "createdAt"],
        limit: this.localLookback,
        orderBy: { createdAt: QueryOrder.DESC },
      },
    );

    const uids = new Set<number>();

    for (const msg of messages) {
      const raw = (msg.provideOriginalPayload || {}) as {
        uid?: number | string;
      };
      const uid = this.normalizeUid(raw.uid);
      if (uid !== null) {
        uids.add(uid);
      }
    }

    return uids;
  }

  private normalizeUid(value: unknown): number | null {
    if (typeof value === "number" && Number.isFinite(value)) {
      return value;
    }

    if (typeof value === "string") {
      const parsed = Number.parseInt(value, 10);
      if (Number.isFinite(parsed)) {
        return parsed;
      }
    }

    return null;
  }
}
