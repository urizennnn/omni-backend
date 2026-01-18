import { ApplicationConfiguration } from "@app/config/app.config";
import { UserEntity, RoleEntity } from "@app/entities/user.entity";
import { Roles } from "@app/types";
import { EntityManager, EntityRepository } from "@mikro-orm/core";
import { Inject, Injectable, Logger, OnModuleInit } from "@nestjs/common";
import { ConfigType } from "@nestjs/config";

@Injectable()
export class Seed implements OnModuleInit {
  private readonly logger = new Logger(Seed.name);
  private readonly userRepo: EntityRepository<UserEntity>;
  private readonly roleRepo: EntityRepository<RoleEntity>;
  constructor(
    private readonly em: EntityManager,
    @Inject(ApplicationConfiguration.KEY)
    private readonly appCfg: ConfigType<typeof ApplicationConfiguration>,
  ) {
    this.userRepo = em.getRepository(UserEntity);
    this.roleRepo = em.getRepository(RoleEntity);
  }
  onModuleInit() {
    (async () => {
      await Promise.all([this.seedRoles(), this.seedSuperAdmin()]);
    })();
  }

  async seedSuperAdmin() {
    try {
      this.logger.log("Seeding super admin user...");
      const email = this.appCfg.superAdminEmail;
      const firstName = this.appCfg.superAdminFirstName;
      const lastName = this.appCfg.superAdminLastName;
      const phone = this.appCfg.superAdminPhone;
      const forkEm = this.em.fork();
      const user = await forkEm.findOne(UserEntity, { email });
      if (!user) {
        await this.em.transactional(async () => {
          const superUser = this.userRepo.create({
            email,
            firstName: firstName,
            disabled: false,
            lastName: lastName,
            status: "active",
            phoneNumber: phone,
            role: await this.roleRepo.findOneOrFail({ name: "super-admin" }),
            emailVerifiedAt: new Date(),
            platformAccess: [],
          });
          await this.em.persistAndFlush(superUser);
        });
      }
      this.logger.log("Super admin user seeded successfully");
    } catch (error) {
      this.logger.error("Failed to seed super admin user", error);
    }
  }

  async seedRoles() {
    const names = ["super-admin", "PA"] as Roles[];

    try {
      await this.em.transactional(async (em) => {
        const repo = em.getRepository(RoleEntity);

        const existing = await repo.find(
          { name: { $in: names } },
          { fields: ["name"] },
        );
        const have = new Set(existing.map((r) => r.name));
        const missing = names.filter((n) => !have.has(n));

        if (missing.length === 0) {
          this.logger.log("Roles already exist. Skipping seed.");
          return;
        }

        await this.em.persistAndFlush(
          missing.map((name) => repo.create({ name })),
        );
        this.logger.log(`Seeded roles: ${missing.join(", ")}`);
      });
    } catch (error) {
      this.logger.error("Failed to seed roles", error);
    }
  }
}
