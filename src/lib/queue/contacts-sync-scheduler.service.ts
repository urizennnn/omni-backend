import {
  Injectable,
  Logger,
  OnModuleInit,
  OnModuleDestroy,
} from "@nestjs/common";
import { InjectQueue } from "@nestjs/bullmq";
import { Queue } from "bullmq";
import { InjectRepository } from "@mikro-orm/nestjs";
import { EntityRepository } from "@mikro-orm/core";
import { ConnectedAccountsEntity } from "@app/entities/connected-accounts.entity";
import { SocialMediaPlatform } from "@app/types";
import { ContactsSyncJobData } from "./contacts-sync.processor";
import { QueueName, JobName } from "./queue.constants";

@Injectable()
export class ContactsSyncScheduler implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(ContactsSyncScheduler.name);
  private intervalId?: NodeJS.Timeout;
  private readonly SYNC_INTERVAL_MS = 30_000; // 30 seconds

  constructor(
    @InjectQueue(QueueName.ContactsSync)
    private readonly contactsSyncQueue: Queue<ContactsSyncJobData>,
    @InjectRepository(ConnectedAccountsEntity)
    private readonly accountRepo: EntityRepository<ConnectedAccountsEntity>,
  ) {}

  async onModuleInit() {
    this.logger.log(
      `Starting contacts sync scheduler (interval: ${this.SYNC_INTERVAL_MS}ms)`,
    );

    await this.scheduleContactsSyncJobs().catch((error) => {
      this.logger.error(
        `Failed to schedule initial contacts sync jobs: ${error}`,
      );
    });

    this.intervalId = setInterval(() => {
      this.scheduleContactsSyncJobs().catch((error) => {
        this.logger.error(`Failed to schedule contacts sync jobs: ${error}`);
      });
    }, this.SYNC_INTERVAL_MS);
  }

  onModuleDestroy() {
    if (this.intervalId) {
      clearInterval(this.intervalId);
      this.logger.log("Contacts sync scheduler stopped");
    }
  }

  private async scheduleContactsSyncJobs(): Promise<void> {
    try {
      const accounts = await this.accountRepo.find(
        {
          platform: SocialMediaPlatform.Telegram,
          status: "active",
        },
        { populate: ["user"] },
      );

      this.logger.debug(
        `Found ${accounts.length} active Telegram accounts for contact sync`,
      );

      for (const account of accounts) {
        await this.contactsSyncQueue.add(
          JobName.SyncContacts,
          {
            accountId: account.id,
            platform: account.platform,
            userId: account.user.id,
          },
          {
            jobId: `contacts-sync-${account.id}`,
            removeOnComplete: true,
            removeOnFail: false,
            attempts: 3,
            backoff: {
              type: "exponential",
              delay: 5000,
            },
          },
        );

        this.logger.debug(
          `Scheduled contacts sync job for account ${account.id}`,
        );
      }
    } catch (error) {
      this.logger.error(
        `Error scheduling contacts sync jobs: ${error instanceof Error ? error.message : String(error)}`,
      );
      throw error;
    }
  }
}
