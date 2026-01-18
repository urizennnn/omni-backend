import { Module } from "@nestjs/common";
import { MikroOrmModule } from "@mikro-orm/nestjs";
import { ConfigModule } from "@nestjs/config";
import { ConnectedAccountsController } from "./connected-accounts.controller";
import { ConnectedAccountsService } from "./connected-accounts.service";
import { ConnectedAccountsEntity } from "@app/entities/connected-accounts.entity";
import { JwtAuthGuard } from "@app/common/guards/jwt-auth.guard";
import { JwtConfiguration } from "@app/config/jwt.config";
import { UserEntity } from "@app/entities/user.entity";

@Module({
  imports: [
    MikroOrmModule.forFeature([ConnectedAccountsEntity, UserEntity]),
    ConfigModule.forFeature(JwtConfiguration),
  ],
  controllers: [ConnectedAccountsController],
  providers: [ConnectedAccountsService, JwtAuthGuard],
  exports: [ConnectedAccountsService],
})
export class ConnectedAccountsModule {}
