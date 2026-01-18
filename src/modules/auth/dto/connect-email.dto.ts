import {
  IsEmail,
  IsString,
  IsNumber,
  IsBoolean,
  IsOptional,
  MinLength,
} from "class-validator";

export class ConnectEmailDto {
  @IsEmail()
  email: string;

  @IsString()
  @MinLength(1)
  imapPassword: string;

  @IsString()
  @MinLength(1)
  smtpPassword: string;

  @IsString()
  imapHost: string;

  @IsNumber()
  imapPort: number;

  @IsBoolean()
  imapSecure: boolean;

  @IsString()
  @IsOptional()
  smtpHost?: string;

  @IsNumber()
  @IsOptional()
  smtpPort?: number;

  @IsBoolean()
  @IsOptional()
  smtpSecure?: boolean;
}
