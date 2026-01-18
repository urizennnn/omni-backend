import { Processor, WorkerHost } from "@nestjs/bullmq";
import { Job } from "bullmq";
import { Injectable, Logger } from "@nestjs/common";
import { InjectRepository } from "@mikro-orm/nestjs";
import { EntityManager, EntityRepository } from "@mikro-orm/core";
import { ConversationEntity } from "@app/entities/conversation.entity";
import { ContactEntity } from "@app/entities/contact.entity";
import { SocialMediaPlatform } from "@app/types";
import { QueueName } from "./queue.constants";

export interface ConversationDoctorJobData {
  platform?: SocialMediaPlatform;
  userId?: string;
}

@Processor(QueueName.ConversationDoctor, {
  concurrency: 5,
})
@Injectable()
export class ConversationDoctorProcessor extends WorkerHost {
  private readonly logger = new Logger(ConversationDoctorProcessor.name);

  constructor(
    @InjectRepository(ConversationEntity)
    private readonly conversationRepo: EntityRepository<ConversationEntity>,
    @InjectRepository(ContactEntity)
    private readonly contactRepo: EntityRepository<ContactEntity>,
    private readonly em: EntityManager,
  ) {
    super();
  }

  async process(job: Job<ConversationDoctorJobData>): Promise<void> {
    const { platform, userId } = job.data;
    this.logger.log(
      `Starting conversation doctor check${platform ? ` for platform: ${platform}` : ""}${userId ? ` for user: ${userId}` : ""}`,
    );

    const fork = this.em.fork();

    try {
      const conversationFilter: Record<string, unknown> = {};
      if (platform) {
        conversationFilter.platform = platform;
      }
      if (userId) {
        conversationFilter.user = userId;
      }

      const conversations = await fork.find(
        ConversationEntity,
        conversationFilter,
        { populate: ["user"] },
      );

      this.logger.log(`Found ${conversations.length} conversations to check`);

      let updatedCount = 0;

      for (const conversation of conversations) {
        try {
          const externalId = conversation.externalId;

          if (!externalId || !externalId.startsWith("user:")) {
            this.logger.debug(
              `Skipping conversation ${conversation.id} - externalId "${externalId}" is not a user conversation`,
            );
            continue;
          }

          const contactExternalId = externalId.replace("user:", "");

          const contact = await fork.findOne(ContactEntity, {
            externalId: contactExternalId,
            platform: conversation.platform,
            user: conversation.user.id,
          });

          if (!contact) {
            this.logger.debug(
              `No contact found for conversation ${conversation.id} (externalId: ${contactExternalId})`,
            );
            continue;
          }

          if (
            contact.displayName &&
            conversation.name !== contact.displayName
          ) {
            const oldName = conversation.name;
            conversation.name = contact.displayName;

            this.logger.log(
              `Updating conversation ${conversation.id} name from "${oldName}" to "${contact.displayName}"`,
            );

            updatedCount++;
          }
        } catch (error) {
          this.logger.error(
            `Error processing conversation ${conversation.id}: ${error instanceof Error ? error.message : String(error)}`,
          );
        }
      }

      if (updatedCount > 0) {
        await fork.flush();
        this.logger.log(
          `Conversation doctor completed: ${updatedCount} conversations updated`,
        );
      } else {
        this.logger.log(
          `Conversation doctor completed: No conversations needed updating`,
        );
      }
    } catch (error) {
      this.logger.error(
        `Failed to run conversation doctor: ${error instanceof Error ? error.message : String(error)}`,
      );
      throw error;
    }
  }
}
