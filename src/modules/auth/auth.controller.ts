import { TypedBody, TypedRoute } from "@nestia/core";
import { Controller, HttpCode, HttpStatus, Query, Req } from "@nestjs/common";
import { AuthService } from "./auth.service";
import { CollectOnboardingEmailDto } from "./dto/collect-onboarding-email.dto";
import { VerifyMfaDto, VerifyOtpDto } from "./dto/verify-otp.dto";
import { InvitePADto } from "./dto/invtie-pa.dto";
import { SuccessMessage } from "@app/common/decorators/success-message.decorator";
import { RefreshTokenDto } from "./dto/refresh-token.dto";
import { TelegramConnectStep2 } from "./dto/telegram-connect";
import { Auth } from "@app/common/decorators";
import { User } from "@app/common/decorators/user.decorator";
import { ConnectEmailDto } from "./dto/connect-email.dto";
import type { Request } from "express";

@Controller("auth")
export class AuthController {
  constructor(private readonly authService: AuthService) {}

  @TypedRoute.Post("invite-pa")
  @HttpCode(HttpStatus.CREATED)
  @SuccessMessage("PA invited")
  async invitePa(@TypedBody() body: InvitePADto) {
    return this.authService.invitePaUser(body);
  }

  @TypedRoute.Post("request-otp")
  @HttpCode(HttpStatus.ACCEPTED)
  @SuccessMessage("OTP sent")
  async requestOtp(@TypedBody() body: CollectOnboardingEmailDto) {
    return this.authService.requestOtp(body.email);
  }

  @TypedRoute.Post("verify-otp")
  @HttpCode(HttpStatus.OK)
  async verifyOtp(@TypedBody() body: VerifyOtpDto) {
    const { mfaEnabled } = await this.authService.verifyOtp(
      body.email,
      body.otp,
    );
    return { status: "verified", mfaEnabled };
  }

  @TypedRoute.Post("generate-2fa")
  @HttpCode(HttpStatus.OK)
  @SuccessMessage("2FA generated")
  async generate2FA(@TypedBody() body: CollectOnboardingEmailDto) {
    return this.authService.registerMFA(body.email);
  }

  @TypedRoute.Post("verify-2fa")
  @HttpCode(HttpStatus.OK)
  @SuccessMessage("2FA verified")
  async verify2FA(@TypedBody() body: VerifyMfaDto) {
    return this.authService.verifyMFA(body.email, body.token);
  }

  @TypedRoute.Post("refresh")
  @HttpCode(HttpStatus.OK)
  async refresh(@TypedBody() body: RefreshTokenDto) {
    return this.authService.refreshAccessToken(body.refreshToken);
  }

  @TypedRoute.Post("connect-telegram")
  @Auth()
  @HttpCode(HttpStatus.OK)
  @SuccessMessage(
    "Telegram connection initiated, please chek your application for the code",
  )
  async connectTelegram() {
    return this.authService.connectTelegram();
  }
  @TypedRoute.Post("verify-telegram")
  @Auth()
  @HttpCode(HttpStatus.OK)
  @SuccessMessage("Telegram connection verified successfully")
  async verifyTelegram(@TypedBody() body: TelegramConnectStep2) {
    return this.authService.verifyTelegram(
      body.loginId,
      body.code,
      body.twoFAcode,
    );
  }

  @TypedRoute.Post("connect-x")
  @Auth()
  @HttpCode(HttpStatus.OK)
  @SuccessMessage("X OAuth flow initiated")
  async connectX(@User("id") userId: string) {
    return this.authService.connectX(userId);
  }

  @TypedRoute.Get("x/callback")
  @HttpCode(HttpStatus.OK)
  @SuccessMessage("X account connected successfully")
  async xCallback(@Query("code") code: string, @Query("state") state: string) {
    return this.authService.handleXCallback(code, state);
  }

  @TypedRoute.Post("connect-email")
  @Auth()
  @HttpCode(HttpStatus.OK)
  @SuccessMessage("Email account connected successfully")
  async connectEmail(
    @TypedBody() body: ConnectEmailDto,
    @Req() req: Request & { user: { id: string } },
  ) {
    return this.authService.connectEmail(req.user.id, body);
  }
}
