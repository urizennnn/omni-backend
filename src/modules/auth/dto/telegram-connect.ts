import { IsNotEmpty, IsOptional, IsString } from "class-validator";

export class TelegramConnectStep2 {
  @IsString()
  @IsNotEmpty()
  loginId: string;

  @IsString()
  @IsNotEmpty()
  code: string;

  @IsString()
  @IsOptional()
  twoFAcode?: string;
}
