import { Module } from "@nestjs/common";
import { MikroOrmModule } from "@mikro-orm/nestjs";
import { UserController } from "./user.controller";
import { UserService } from "./user.service";
import { UserEntity, RoleEntity } from "@app/entities/user.entity";
import { JwtAuthGuard } from "@app/common/guards/jwt-auth.guard";
import { ConfigModule } from "@nestjs/config";
import { JwtConfiguration } from "@app/config/jwt.config";

@Module({
  imports: [
    MikroOrmModule.forFeature([UserEntity, RoleEntity]),
    ConfigModule.forFeature(JwtConfiguration),
  ],
  controllers: [UserController],
  providers: [UserService, JwtAuthGuard],
  exports: [UserService],
})
export class UserModule {}
