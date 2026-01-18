import { Module } from "@nestjs/common";
import { MikroOrmModule } from "@mikro-orm/nestjs";
import { CacheService } from "./cache.service";
import { UserEntity } from "../../entities/user.entity";
import { UserSocialSessionEntity } from "../../entities/user-social-session.entity";
import { RedisModule } from "../../lib/redis/redis.module";
import { ConfigModule } from "@nestjs/config";
import { ApplicationConfiguration } from "@app/config/app.config";

@Module({
  imports: [
    MikroOrmModule.forFeature([UserEntity, UserSocialSessionEntity]),
    ConfigModule.forFeature(ApplicationConfiguration),
    RedisModule,
  ],
  providers: [CacheService],
  exports: [CacheService],
})
export class CacheModule {}
