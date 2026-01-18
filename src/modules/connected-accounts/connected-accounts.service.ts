import { Injectable, NotFoundException } from "@nestjs/common";
import { InjectRepository } from "@mikro-orm/nestjs";
import { EntityRepository } from "@mikro-orm/core";
import { ConnectedAccountsEntity } from "@app/entities/connected-accounts.entity";
import { SocialMediaPlatform } from "@app/types";

@Injectable()
export class ConnectedAccountsService {
  constructor(
    @InjectRepository(ConnectedAccountsEntity)
    private readonly connectedAccountsRepo: EntityRepository<ConnectedAccountsEntity>,
  ) {}

  async deactivatePlatform(userId: string, platform: SocialMediaPlatform) {
    const connectedAccount = await this.connectedAccountsRepo.findOne({
      user: userId,
      platform,
    });

    if (!connectedAccount) {
      throw new NotFoundException(
        `No connected account found for platform: ${platform}`,
      );
    }

    connectedAccount.status = "suspended";
    await this.connectedAccountsRepo.getEntityManager().flush();

    return {
      message: `Platform ${platform} has been deactivated`,
      platform,
      status: connectedAccount.status,
    };
  }
}
