import { Module, forwardRef } from "@nestjs/common";
import { MessageController } from "./message.controller";
import { MessageService } from "./message.service";
import { ConversationEntity } from "@app/entities/conversation.entity";
import { RoleEntity, UserEntity } from "@app/entities/user.entity";
import { ConnectedAccountsEntity } from "@app/entities/connected-accounts.entity";
import { MikroOrmModule } from "@mikro-orm/nestjs";
import { RegistryModule } from "@app/lib/social-media-registry/registry.module";
import { UserSocialSessionEntity } from "@app/entities/user-social-session.entity";
import { ConfigModule } from "@nestjs/config";
import { ApplicationConfiguration } from "@app/config/app.config";
import { MessageEntity } from "@app/entities/messages.entity";
import { CacheService } from "@app/common/cache";
import { UserOtpEntity } from "@app/entities/user-otp.entity";
import { AuthModule } from "../auth/auth.module";
import { JwtConfiguration } from "@app/config/jwt.config";

@Module({
  imports: [
    ConfigModule.forFeature(ApplicationConfiguration),
    ConfigModule.forFeature(JwtConfiguration),
    MikroOrmModule.forFeature([
      UserEntity,
      ConversationEntity,
      UserOtpEntity,
      RoleEntity,
      UserSocialSessionEntity,
      MessageEntity,
      ConnectedAccountsEntity,
    ]),
    forwardRef(() => AuthModule),
    forwardRef(() => RegistryModule),
  ],
  controllers: [MessageController],
  providers: [MessageService, CacheService],
  exports: [MessageService],
})
export class MessageModule {}
