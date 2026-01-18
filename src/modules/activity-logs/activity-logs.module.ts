import { Module } from "@nestjs/common";
import { MikroOrmModule } from "@mikro-orm/nestjs";
import { ActivityLogsController } from "./activity-logs.controller";
import { ActivityLogsService } from "./activity-logs.service";
import { ActivityLogEntity } from "@app/entities/activity-log.entity";
import { RoleEntity, UserEntity } from "@app/entities/user.entity";
import { ConfigModule } from "@nestjs/config";
import { JwtConfiguration } from "@app/config/jwt.config";

@Module({
  imports: [
    ConfigModule.forFeature(JwtConfiguration),
    MikroOrmModule.forFeature([ActivityLogEntity, UserEntity, RoleEntity]),
  ],
  controllers: [ActivityLogsController],
  providers: [ActivityLogsService],
  exports: [ActivityLogsService],
})
export class ActivityLogsModule {}
