import { Global, Module, forwardRef } from "@nestjs/common";
import { ConfigModule, ConfigType } from "@nestjs/config";
import { MikroOrmModule } from "@mikro-orm/nestjs";
import { BullModule } from "@nestjs/bullmq";
import * as Pusher from "pusher";
import { PusherConfiguration } from "@app/config/pusher.config";
import { JwtConfiguration } from "@app/config/jwt.config";
import { MfaConfiguration } from "@app/config/mfa.config";
import { PUSHER_CLIENT } from "./pusher.constants";
import { PusherService } from "./pusher.service";
import { PusherAuthController } from "./pusher-auth.controller";
import { PusherWebhookController } from "./pusher-webhook.controller";
import { UserEntity } from "@app/entities/user.entity";
import { MessageModule } from "@app/modules/message/message.module";
import { UtilsService } from "@app/common/utils.service";
import { RegistryModule } from "@app/lib/social-media-registry/registry.module";
import { UserSocialSessionEntity } from "@app/entities/user-social-session.entity";
import { ConversationEntity } from "@app/entities/conversation.entity";
import { CacheModule } from "@app/common/cache/cache.module";
import { ApplicationConfiguration } from "@app/config/app.config";
import { QueueName } from "@app/lib/queue/queue.constants";

@Global()
@Module({
  imports: [
    ConfigModule.forFeature(PusherConfiguration),
    ConfigModule.forFeature(JwtConfiguration),
    ConfigModule.forFeature(MfaConfiguration),
    ConfigModule.forFeature(ApplicationConfiguration),
    MikroOrmModule.forFeature([
      UserEntity,
      UserSocialSessionEntity,
      ConversationEntity,
    ]),
    BullModule.registerQueue({
      name: QueueName.PusherWebhooks,
    }),
    forwardRef(() => MessageModule),
    RegistryModule,
    CacheModule,
  ],
  controllers: [PusherAuthController, PusherWebhookController],
  providers: [
    {
      provide: PUSHER_CLIENT,
      inject: [PusherConfiguration.KEY],
      useFactory: (config: ConfigType<typeof PusherConfiguration>) => {
        return new Pusher({
          appId: config.appId,
          key: config.pusherKey,
          secret: config.pusherSecret,
          cluster: config.pusherCluster,
          useTLS: true,
        });
      },
    },
    PusherService,
    UtilsService,
  ],
  exports: [PusherService, PUSHER_CLIENT],
})
export class PusherModule {}
