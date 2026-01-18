import { Module } from "@nestjs/common";
import { EmailProvider } from "./email.provider";
import { EmailConnectionManager } from "./email-connection.manager";
import { UtilsService } from "@app/common/utils.service";
import { ConfigModule } from "@nestjs/config";
import { EmailConfiguration } from "@app/config/email.config";
import { MikroOrmModule } from "@mikro-orm/nestjs";
import { MessageEntity } from "@app/entities/messages.entity";

@Module({
  imports: [
    ConfigModule.forFeature(EmailConfiguration),
    MikroOrmModule.forFeature([MessageEntity]),
  ],
  providers: [EmailProvider, EmailConnectionManager, UtilsService],
  exports: [EmailProvider],
})
export class EmailModule {}
