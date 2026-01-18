import { Module } from "@nestjs/common";
import { Seed } from "./seed";
import { UserEntity, RoleEntity } from "@app/entities/user.entity";
import { MikroOrmModule } from "@mikro-orm/nestjs";
import { ConfigModule } from "@nestjs/config";
import { ApplicationConfiguration } from "@app/config/app.config";

@Module({
  imports: [
    ConfigModule.forFeature(ApplicationConfiguration),
    MikroOrmModule.forFeature([UserEntity, RoleEntity]),
  ],
  providers: [Seed],
})
export class SeedModule {}
