import { registerAs } from "@nestjs/config";

type JwtConfig = {
  secret: string;
  expiresIn: string;
  refreshSecret: string;
  refreshExpiresIn: string;
};

export const JwtConfiguration = registerAs("jwt", (): JwtConfig => {
  const secret = process.env.JWT_SECRET ?? "";
  const refreshSecret = process.env.JWT_REFRESH_SECRET ?? secret;

  return {
    secret,
    expiresIn: process.env.JWT_EXPIRES_IN ?? "1h",
    refreshSecret,
    refreshExpiresIn: process.env.JWT_REFRESH_EXPIRES_IN ?? "7d",
  };
});
