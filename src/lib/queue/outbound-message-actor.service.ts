import { Injectable, Logger } from "@nestjs/common";
import { InjectRepository } from "@mikro-orm/nestjs";
import { EntityRepository } from "@mikro-orm/core";
import { CacheService } from "@app/common/cache";
import { MessageActorMappingEntity } from "@app/entities/message-actor-mapping.entity";
import { SocialMediaPlatform, SenderRole } from "@app/types";
import { UserEntity } from "@app/entities/user.entity";

export type OutboundActorMapping = {
  actorUserId: string;
  senderRole: SenderRole;
};

@Injectable()
export class OutboundMessageActorService {
  private readonly logger = new Logger(OutboundMessageActorService.name);

  constructor(
    private readonly cacheService: CacheService,
    @InjectRepository(MessageActorMappingEntity)
    private readonly mappingRepo: EntityRepository<MessageActorMappingEntity>,
  ) {}

  async recordMapping(params: {
    platform: SocialMediaPlatform;
    accountId: string;
    messageId: string;
    actorUserId: string;
    senderRole: SenderRole;
  }): Promise<void> {
    const { platform, accountId, messageId, actorUserId, senderRole } = params;
    if (!platform || !accountId || !messageId || !actorUserId) {
      this.logger.warn("Skipping outbound actor mapping with missing fields");
      return;
    }

    await this.cacheService.cacheOutboundMessageActor({
      platform,
      accountId,
      messageId,
      actorUserId,
      senderRole,
    });

    try {
      const existing = await this.mappingRepo.findOne({
        platform,
        accountId,
        messageId,
      });

      const actorRef = this.mappingRepo
        .getEntityManager()
        .getReference(UserEntity, actorUserId);

      if (existing) {
        existing.actorUser = actorRef;
        existing.senderRole = senderRole;
        await this.mappingRepo.getEntityManager().persistAndFlush(existing);
        return;
      }

      const mapping = this.mappingRepo.create({
        platform,
        accountId,
        messageId,
        actorUser: actorRef,
        senderRole,
      });

      await this.mappingRepo.getEntityManager().persistAndFlush(mapping);
    } catch (error) {
      this.logger.warn(
        `Failed to persist outbound actor mapping: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }

  async resolveMapping(params: {
    platform: SocialMediaPlatform;
    accountId: string;
    messageId: string;
  }): Promise<OutboundActorMapping | null> {
    const { platform, accountId, messageId } = params;
    if (!platform || !accountId || !messageId) return null;

    const cached = await this.cacheService.getOutboundMessageActor({
      platform,
      accountId,
      messageId,
    });
    if (cached) {
      return cached;
    }

    let mapping: MessageActorMappingEntity | null = null;
    try {
      mapping = await this.mappingRepo.findOne({
        platform,
        accountId,
        messageId,
      });
    } catch (error) {
      this.logger.warn(
        `Failed to load outbound actor mapping: ${error instanceof Error ? error.message : String(error)}`,
      );
      return null;
    }
    if (!mapping) {
      return null;
    }

    const result: OutboundActorMapping = {
      actorUserId: mapping.actorUser.id,
      senderRole: mapping.senderRole,
    };

    await this.cacheService.cacheOutboundMessageActor({
      platform,
      accountId,
      messageId,
      actorUserId: result.actorUserId,
      senderRole: result.senderRole,
    });

    await this.mappingRepo.nativeDelete({ id: mapping.id });
    return result;
  }
}
