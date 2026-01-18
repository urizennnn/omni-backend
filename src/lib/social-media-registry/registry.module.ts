import { Module, forwardRef } from "@nestjs/common";
import { ProviderRegistry } from "./provider.registry";
import { MikroOrmModule } from "@mikro-orm/nestjs";
import { UserSocialSessionEntity } from "@app/entities/user-social-session.entity";
import { ConnectedAccountsEntity } from "@app/entities/connected-accounts.entity";
import { ContactEntity } from "@app/entities/contact.entity";
import { ApplicationConfiguration } from "@app/config/app.config";
import { TelegramConfiguration } from "@app/config/telegram.config";
import { ConfigModule, ConfigType } from "@nestjs/config";
import Redis from "ioredis";
import { TelegramProvider } from "./providers/telegram/telegram.provider";
import { RegistryService } from "./registry.service";
import { MessagingService } from "./messaging.service";
import { PollProcessor } from "../queue/poll.processor";
import { MessageProcessor } from "../queue/message.processor";
import { ConnectorProcessor } from "../queue/connector.processor";
import { PusherWebhookProcessor } from "../queue/pusher-webhook.processor";
import { BullModule } from "@nestjs/bullmq";
import { UtilsService } from "@app/common/utils.service";
import { MfaConfiguration } from "@app/config/mfa.config";
import { MessageEntity } from "@app/entities/messages.entity";
import { ConversationEntity } from "@app/entities/conversation.entity";
import { UserEntity } from "@app/entities/user.entity";
import { MessageActorMappingEntity } from "@app/entities/message-actor-mapping.entity";
import { PusherService } from "@app/lib/pusher/pusher.service";
import { TelegramEventListener } from "./providers/telegram/telegram-event-listener.service";
import { CacheService } from "@app/common/cache";
import { XAPIConfiguration } from "@app/config/x.config";
import { XProvider } from "./providers/x/x.provider";
import { XRateLimiterService } from "./providers/x/x-rate-limiter.service";
import { EmailProvider } from "./providers/email/email.provider";
import { EmailConnectionManager } from "./providers/email/email-connection.manager";
import { EmailConfiguration } from "@app/config/email.config";
import { MailgunConfiguation } from "@app/config/mailgun.config";
import { QueueName } from "../queue/queue.constants";
import { EmailReconciliationProcessor } from "../queue/email-reconciliation.processor";
import { EmailReconciliationScheduler } from "../queue/email-reconciliation-scheduler.service";
import { MessageModule } from "@app/modules/message/message.module";
import { OutboundMessageActorService } from "../queue/outbound-message-actor.service";

@Module({
  imports: [
    MikroOrmModule.forFeature([
      UserSocialSessionEntity,
      ContactEntity,
      MessageEntity,
      ConversationEntity,
      ConnectedAccountsEntity,
      UserEntity,
      MessageActorMappingEntity,
    ]),
    forwardRef(() => MessageModule),
    ConfigModule.forFeature(ApplicationConfiguration),
    ConfigModule.forFeature(MfaConfiguration),
    ConfigModule.forFeature(TelegramConfiguration),
    ConfigModule.forFeature(XAPIConfiguration),
    ConfigModule.forFeature(EmailConfiguration),
    ConfigModule.forFeature(MailgunConfiguation),
    BullModule.forRoot({
      connection: new Redis(process.env.REDIS_URL!, {
        maxRetriesPerRequest: null,
        tls: process.env.REDIS_URL?.startsWith("rediss://") ? {} : undefined,
      }),
    }),
    BullModule.registerQueue({
      name: QueueName.SocialMediaPoll,
    }),
    BullModule.registerQueue({
      name: QueueName.Messages,
      defaultJobOptions: {
        removeOnFail: true,
      },
    }),
    BullModule.registerQueue({
      name: QueueName.ContactsSync,
    }),
    BullModule.registerQueue({
      name: QueueName.ConversationDoctor,
    }),
    BullModule.registerQueue({
      name: QueueName.PusherWebhooks,
    }),
    BullModule.registerQueue({
      name: QueueName.EmailReconciliation,
    }),
    BullModule.registerQueue({
      name: "platform-connection",
    }),
  ],
  providers: [
    TelegramProvider,
    TelegramEventListener,
    EmailProvider,
    EmailConnectionManager,
    UtilsService,
    XProvider,
    XRateLimiterService,
    ProviderRegistry,
    RegistryService,
    MessagingService,
    PollProcessor,
    CacheService,
    MessageProcessor,
    OutboundMessageActorService,
    ConnectorProcessor,
    PusherWebhookProcessor,
    PusherService,
    // EmailReconciliationProcessor,
    // EmailReconciliationScheduler,
  ],
  exports: [
    ProviderRegistry,
    TelegramProvider,
    XProvider,
    EmailProvider,
    MessagingService,
  ],
})
export class RegistryModule {}
