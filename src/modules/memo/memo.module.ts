import { Module } from "@nestjs/common";
import { MikroOrmModule } from "@mikro-orm/nestjs";
import { MemoController } from "./memo.controller";
import { MemoService } from "./memo.service";
import { MemoEntity } from "@app/entities/memo.entity";
import { ConversationEntity } from "@app/entities/conversation.entity";
import { RoleEntity, UserEntity } from "@app/entities/user.entity";
import { ConfigModule } from "@nestjs/config";
import { JwtConfiguration } from "@app/config/jwt.config";

@Module({
  imports: [
    ConfigModule.forFeature(JwtConfiguration),
    MikroOrmModule.forFeature([
      MemoEntity,
      ConversationEntity,
      UserEntity,
      RoleEntity,
    ]),
  ],
  controllers: [MemoController],
  providers: [MemoService],
  exports: [MemoService],
})
export class MemoModule {}
