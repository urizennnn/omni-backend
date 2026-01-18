import { Injectable, Logger, OnModuleInit } from "@nestjs/common";
import { ProviderRegistry } from "./provider.registry";
import { InjectRepository } from "@mikro-orm/nestjs";
import { EntityRepository } from "@mikro-orm/core";
import { ConnectedAccountsEntity } from "@app/entities/connected-accounts.entity";
import { SocialMediaPlatform } from "@app/types";
import { InjectQueue } from "@nestjs/bullmq";
import { Queue } from "bullmq";
import { PollJobData } from "../queue/poll.processor";
import { QueueName, JobName } from "../queue/queue.constants";

@Injectable()
export class RegistryService implements OnModuleInit {
  private readonly logger = new Logger(RegistryService.name);
  private activePlatforms: Set<SocialMediaPlatform> = new Set();
  private pollingIntervalId?: NodeJS.Timeout;

  constructor(
    private readonly drivers: ProviderRegistry,
    @InjectRepository(ConnectedAccountsEntity)
    private readonly accountRepo: EntityRepository<ConnectedAccountsEntity>,
    @InjectQueue(QueueName.SocialMediaPoll)
    private readonly pollQueue: Queue<PollJobData>,
  ) {}

  async onModuleInit() {
    this.logger.log("RegistryService initialized");
    await this.loadActivePlatforms();
    this.logger.log(
      `Active platforms from DB: ${Array.from(this.activePlatforms).join(", ")}`,
    );

    this.removeInactiveDrivers();

    this.logger.log(
      `Registered drivers: ${Array.from(this.drivers["drivers"].keys()).join(", ")}`,
    );
    this.logger.log(
      `Total drivers registered: ${this.drivers["drivers"].size}`,
    );

    this.startPollingScheduler();
  }

  onModuleDestroy() {
    if (this.pollingIntervalId) {
      clearInterval(this.pollingIntervalId);
    }
  }

  private removeInactiveDrivers(): void {
    const allDrivers = this.drivers.listAllDrivers();

    for (const driver of allDrivers) {
      if (!this.isActivePlatform(driver.key)) {
        this.logger.log(`Removing inactive driver: ${driver.key}`);
        this.drivers.removeDriver(driver.key);
      }
    }
  }

  async loadActivePlatforms(): Promise<void> {
    const activeAccounts = await this.accountRepo.find({
      status: "active",
    });

    this.activePlatforms = new Set(
      activeAccounts.map((account) => account.platform),
    );
  }

  getActivePlatforms(): Set<SocialMediaPlatform> {
    return this.activePlatforms;
  }

  isActivePlatform(platform: SocialMediaPlatform): boolean {
    return this.activePlatforms.has(platform);
  }

  private startPollingScheduler(): void {
    const POLL_INTERVAL_MS = 30_000;

    this.logger.log(
      `Starting polling scheduler (interval: ${POLL_INTERVAL_MS}ms)`,
    );

    this.schedulePollJobs().catch((error) => {
      this.logger.error(`Failed to schedule initial poll jobs: ${error}`);
    });

    this.pollingIntervalId = setInterval(() => {
      this.schedulePollJobs().catch((error) => {
        this.logger.error(`Failed to schedule poll jobs: ${error}`);
      });
    }, POLL_INTERVAL_MS);
  }

  private async schedulePollJobs(): Promise<void> {
    try {
      await this.loadActivePlatforms();

      this.logger.debug(
        `Active platforms: ${Array.from(this.activePlatforms).join(", ")}`,
      );

      const accounts = await this.accountRepo.find({
        platform: { $in: Array.from(this.activePlatforms) },
        status: "active",
      });

      this.logger.log(`Found ${accounts.length} active accounts to poll`);

      for (const account of accounts) {
        this.logger.debug(
          `Checking account ${account.id} (${account.platform}, last polled: ${account.lastPolledAt})`,
        );
        if (account.platform === SocialMediaPlatform.Telegram) {
          this.logger.debug(
            `Skipping poll job for ${account.platform} account ${account.id} (event-driven)`,
          );
          continue;
        }

        const now = Date.now();
        const lastPolledMs = account.lastPolledAt?.getTime() || 0;
        const pollingIntervalMs = (account.pollingInterval || 60) * 1000;
        const nextPollDue = lastPolledMs + pollingIntervalMs;

        if (now >= nextPollDue) {
          this.logger.log(
            `Scheduling poll job for account ${account.id} (${account.platform})`,
          );

          await this.pollQueue.add(
            JobName.PollAccount,
            {
              accountId: account.id,
              platform: account.platform,
            },
            {
              jobId: account.jobKey,
              removeOnComplete: true,
              removeOnFail: false,
              attempts: 3,
              backoff: {
                type: "exponential",
                delay: 5000,
              },
            },
          );

          this.logger.log(
            `✓ Successfully scheduled poll job for account ${account.id} (${account.platform})`,
          );
        } else {
          const waitMs = nextPollDue - now;
          this.logger.debug(
            `Account ${account.id} not due yet, next poll in ${Math.round(waitMs / 1000)}s`,
          );
        }
      }
    } catch (error) {
      this.logger.error(
        `Error scheduling poll jobs: ${error instanceof Error ? error.message : String(error)}`,
      );
      throw error;
    }
  }
}
