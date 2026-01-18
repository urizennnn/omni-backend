import { Injectable, Logger, NotFoundException, ForbiddenException, BadRequestException } from "@nestjs/common";
import { InjectRepository } from "@mikro-orm/nestjs";
import { EntityRepository } from "@mikro-orm/core";
import { PlatformAccess, UserEntity } from "@app/entities/user.entity";

@Injectable()
export class UserService {
  private logger = new Logger(UserService.name);
  constructor(
    @InjectRepository(UserEntity)
    private readonly userRepository: EntityRepository<UserEntity>,
  ) {}

  async getUserById(id: string): Promise<UserEntity> {
    const user = await this.userRepository.findOne(
      { id },
      { populate: ["role"] },
    );

    if (!user) {
      throw new NotFoundException("User not found");
    }

    return user;
  }

  async disableUser(id: string, actorId: string) {
    if (id === actorId) {
      throw new ForbiddenException("User cannot disable their own account");
    }

    const user = await this.getUserById(id);
    user.status = "disabled";
    this.logger.log(`Disabling user with id: ${id}`);
    await this.userRepository.getEntityManager().persistAndFlush(user);
    return;
  }

  async enableUser(id: string, actorId: string) {
    if (id === actorId) {
      throw new ForbiddenException("User cannot enable their own account");
    }

    const user = await this.getUserById(id);

    if (user.status !== "disabled") {
      throw new BadRequestException(
        `User is not disabled, current status: ${user.status}`
      );
    }

    user.status = "active";
    this.logger.log(`Enabling user with id: ${id}`);
    await this.userRepository.getEntityManager().persistAndFlush(user);
    return;
  }

  async viewPermissions(id: string) {
    const user = await this.getUserById(id);
    return user.platformAccess;
  }

  async updateUserPlatformAccess(id: string, access: PlatformAccess[]) {
    const user = await this.getUserById(id);
    this.logger.log("Updating platform access for user with id: " + id);
    access.forEach((newAccess) => {
      const existing = user.platformAccess.find(
        (entry) => entry.platform === newAccess.platform,
      );

      if (existing) {
        existing.canSend = newAccess.canSend;
        existing.viewMessages = newAccess.viewMessages;
      } else {
        user.platformAccess.push(newAccess);
      }
    });
    return this.userRepository.getEntityManager().persistAndFlush(user);
  }

  async deleteUser(id: string, actorId: string) {
    if (id === actorId) {
      throw new ForbiddenException("User cannot delete their own account");
    }

    const user = await this.getUserById(id);
    this.logger.log(`Deleting user with id: ${id}`);
    const number = await this.userRepository.nativeDelete(user);
    this.logger.log(`Number of users deleted: ${number}`);
    return;
  }

  async getAllUsers(limit: number, offset: number) {
    const [users, total] = await this.userRepository.findAndCount(
      {},
      { limit, offset, populate: ["role"] },
    );

    return { users, total, limit, offset };
  }
}
