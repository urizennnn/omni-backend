import {
  IsEmail,
  IsString,
  IsNotEmpty,
  IsArray,
  ValidateNested,
  IsBoolean,
  IsEnum,
} from "class-validator";
import { Type } from "class-transformer";
import { SocialMediaPlatform } from "@app/types";

class PlatformAccessDto {
  @IsEnum(SocialMediaPlatform)
  platform: SocialMediaPlatform;

  @IsBoolean()
  canSend: boolean;

  @IsBoolean()
  viewMessages: boolean;
}

export class InvitePADto {
  @IsEmail()
  @IsNotEmpty()
  email: string;

  @IsString()
  @IsNotEmpty()
  firstname: string;

  @IsString()
  @IsNotEmpty()
  lastname: string;

  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => PlatformAccessDto)
  platform: PlatformAccessDto[];
}
