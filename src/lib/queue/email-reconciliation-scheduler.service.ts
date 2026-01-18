import {
  Injectable,
  Logger,
  OnModuleDestroy,
  OnModuleInit,
  Inject,
} from "@nestjs/common";
import { InjectQueue } from "@nestjs/bullmq";
import { Queue } from "bullmq";
import { QueueName, JobName } from "./queue.constants";
import { EmailReconciliationJobData } from "./email-reconciliation.processor";
import { InjectRepository } from "@mikro-orm/nestjs";
import { EntityRepository } from "@mikro-orm/core";
import { ConnectedAccountsEntity } from "@app/entities/connected-accounts.entity";
import { SocialMediaPlatform } from "@app/types";
import { EmailConfiguration } from "@app/config/email.config";
import { ConfigType } from "@nestjs/config";

@Injectable()
export class EmailReconciliationScheduler
  implements OnModuleInit, OnModuleDestroy
{
  private readonly logger = new Logger(EmailReconciliationScheduler.name);
  private intervalId?: NodeJS.Timeout;

  constructor(
    @InjectQueue(QueueName.EmailReconciliation)
    private readonly reconciliationQueue: Queue<EmailReconciliationJobData>,
    @InjectRepository(ConnectedAccountsEntity)
    private readonly accountRepo: EntityRepository<ConnectedAccountsEntity>,
    @Inject(EmailConfiguration.KEY)
    private readonly emailConfig: ConfigType<typeof EmailConfiguration>,
  ) {}

  async onModuleInit(): Promise<void> {
    const interval = this.emailConfig.reconciliation.intervalMs;
    this.logger.log(
      `Starting email reconciliation scheduler (interval: ${interval}ms)`,
    );

    await this.scheduleJobs().catch((error) => {
      this.logger.error(
        `Failed to schedule initial email reconciliation jobs: ${error}`,
      );
    });

    this.intervalId = setInterval(() => {
      this.scheduleJobs().catch((error) => {
        this.logger.error(
          `Failed to schedule email reconciliation jobs: ${error}`,
        );
      });
    }, interval);
  }

  onModuleDestroy(): void {
    if (this.intervalId) {
      clearInterval(this.intervalId);
      this.logger.log("Email reconciliation scheduler stopped");
    }
  }

  private async scheduleJobs(): Promise<void> {
    const accounts = await this.accountRepo.find({
      platform: SocialMediaPlatform.Email,
      status: "active",
    });

    this.logger.debug(
      `Found ${accounts.length} active email accounts for reconciliation`,
    );

    for (const account of accounts) {
      await this.reconciliationQueue.add(
        JobName.ReconcileEmailAccount,
        {
          accountId: account.id,
        },
        {
          jobId: `email-reconciliation-${account.id}`,
          removeOnComplete: true,
          removeOnFail: false,
          attempts: 3,
          backoff: {
            type: "exponential",
            delay: 5000,
          },
        },
      );
    }
  }
}
