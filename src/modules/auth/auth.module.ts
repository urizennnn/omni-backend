import { Module, forwardRef } from "@nestjs/common";
import { ConfigModule } from "@nestjs/config";
import { MikroOrmModule } from "@mikro-orm/nestjs";
import { AuthController } from "./auth.controller";
import { AuthService } from "./auth.service";
import { MailgunEmailFactory } from "@app/lib/mailgun-email.factory";
import { MailgunConfiguation } from "@app/config/mailgun.config";
import { UserOtpEntity } from "@app/entities/user-otp.entity";
import { RoleEntity, UserEntity } from "@app/entities/user.entity";
import { UserSocialSessionEntity } from "@app/entities/user-social-session.entity";
import { ConnectedAccountsEntity } from "@app/entities/connected-accounts.entity";
import { JwtConfiguration } from "@app/config/jwt.config";
import { MfaConfiguration } from "@app/config/mfa.config";
import { JwtAuthGuard } from "@app/common/guards/jwt-auth.guard";
import { TelegramConfiguration } from "@app/config/telegram.config";
import { UtilsService } from "@app/common/utils.service";
import { RegistryModule } from "@app/lib/social-media-registry/registry.module";
import { ApplicationConfiguration } from "@app/config/app.config";
import { TelegramEventListener } from "@app/lib/social-media-registry/providers/telegram/telegram-event-listener.service";
import { MessageEntity } from "@app/entities/messages.entity";
import { ConversationEntity } from "@app/entities/conversation.entity";
import { ContactEntity } from "@app/entities/contact.entity";
import { XAPIConfiguration } from "@app/config/x.config";

@Module({
  imports: [
    ConfigModule.forFeature(MailgunConfiguation),
    ConfigModule.forFeature(TelegramConfiguration),
    ConfigModule.forFeature(XAPIConfiguration),
    ConfigModule.forFeature(ApplicationConfiguration),
    ConfigModule.forFeature(JwtConfiguration),
    ConfigModule.forFeature(MfaConfiguration),
    MikroOrmModule.forFeature([
      UserEntity,
      UserOtpEntity,
      RoleEntity,
      MessageEntity,
      ConversationEntity,
      ContactEntity,
      UserSocialSessionEntity,
      ConnectedAccountsEntity,
    ]),
    forwardRef(() => RegistryModule),
  ],
  controllers: [AuthController],
  providers: [
    AuthService,
    MailgunEmailFactory,
    JwtAuthGuard,
    UtilsService,
    TelegramEventListener,
  ],
  exports: [],
})
export class AuthModule {}
