import {
  Injectable,
  Logger,
  OnModuleInit,
  OnModuleDestroy,
} from "@nestjs/common";
import { InjectQueue } from "@nestjs/bullmq";
import { Queue } from "bullmq";
import { ConversationDoctorJobData } from "./conversation-doctor.processor";
import { QueueName, JobName } from "./queue.constants";

@Injectable()
export class ConversationDoctorScheduler
  implements OnModuleInit, OnModuleDestroy
{
  private readonly logger = new Logger(ConversationDoctorScheduler.name);
  private intervalId?: NodeJS.Timeout;
  private readonly CHECK_INTERVAL_MS = 60_000;

  constructor(
    @InjectQueue(QueueName.ConversationDoctor)
    private readonly conversationDoctorQueue: Queue<ConversationDoctorJobData>,
  ) {}

  async onModuleInit() {
    this.logger.log(
      `Starting conversation doctor scheduler (interval: ${this.CHECK_INTERVAL_MS}ms)`,
    );

    await this.scheduleConversationDoctorJob().catch((error) => {
      this.logger.error(
        `Failed to schedule initial conversation doctor job: ${error}`,
      );
    });

    this.intervalId = setInterval(() => {
      this.scheduleConversationDoctorJob().catch((error) => {
        this.logger.error(
          `Failed to schedule conversation doctor job: ${error}`,
        );
      });
    }, this.CHECK_INTERVAL_MS);
  }

  onModuleDestroy() {
    if (this.intervalId) {
      clearInterval(this.intervalId);
      this.logger.log("Conversation doctor scheduler stopped");
    }
  }

  private async scheduleConversationDoctorJob(): Promise<void> {
    try {
      await this.conversationDoctorQueue.add(
        JobName.CheckConversations,
        {},
        {
          jobId: "conversation-doctor-check",
          removeOnComplete: true,
          removeOnFail: false,
          attempts: 3,
          backoff: {
            type: "exponential",
            delay: 5000,
          },
        },
      );

      this.logger.debug("Scheduled conversation doctor job");
    } catch (error) {
      this.logger.error(
        `Error scheduling conversation doctor job: ${error instanceof Error ? error.message : String(error)}`,
      );
      throw error;
    }
  }
}
