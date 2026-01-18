import { Global, Module } from "@nestjs/common";
import { APP_INTERCEPTOR } from "@nestjs/core";
import { ConfigModule, ConfigType } from "@nestjs/config";
import { validateEnvFrom } from "./config/validate-env-from";
import { DatabaseModule } from "./database/database.module";
import { HealthModule } from "./modules/health/health.module";
import { AuthModule } from "./modules/auth/auth.module";
import { MessageModule } from "./modules/message/message.module";
import { ConnectedAccountsModule } from "./modules/connected-accounts/connected-accounts.module";
import { UserModule } from "./modules/user/user.module";
import { MemoModule } from "./modules/memo/memo.module";
import { ActivityLogsModule } from "./modules/activity-logs/activity-logs.module";
import { CorsConfiguration } from "./config/cors.config";
import { LoggerConfiguration } from "./config/logger.config";
import { ApiDocsModule } from "./modules/docs/api-docs.module";
import { SeedModule } from "./database/seed.module";
import { ApplicationConfiguration } from "./config/app.config";
import { RedisModule } from "@app/lib/redis/redis.module";
import { RegistryModule } from "./lib/social-media-registry/registry.module";
import { PusherModule } from "./lib/pusher/pusher.module";
import { JwtModule } from "@nestjs/jwt";
import { JwtConfiguration } from "./config/jwt.config";
import { CacheModule } from "./common/cache";
import { ActivityLogInterceptor } from "./common/interceptors/activity-log.interceptor";

@Global()
@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      envFilePath: ".env",
      validate: validateEnvFrom,
      expandVariables: true,
    }),
    JwtModule.registerAsync({
      global: true,
      imports: [ConfigModule.forFeature(JwtConfiguration)],
      inject: [JwtConfiguration.KEY],
      useFactory: (jwtConfig: ConfigType<typeof JwtConfiguration>) => ({
        secret: jwtConfig.secret,
        signOptions: { expiresIn: jwtConfig.expiresIn },
      }),
    }),

    ConfigModule.forFeature(CorsConfiguration),
    ConfigModule.forFeature(LoggerConfiguration),
    ConfigModule.forFeature(ApplicationConfiguration),
    DatabaseModule,
    CacheModule,
    RedisModule,
    PusherModule,
    SeedModule,
    HealthModule,
    AuthModule,
    UserModule,
    MessageModule,
    MemoModule,
    ActivityLogsModule,
    ConnectedAccountsModule,
    RegistryModule,
    ApiDocsModule,
  ],
  providers: [
    {
      provide: APP_INTERCEPTOR,
      useClass: ActivityLogInterceptor,
    },
  ],
})
export class AppModule {}
