import { registerAs } from "@nestjs/config";

type XAPIConfig = {
  X_API_KEY: string;
  X_API_SECRET: string;
  X_API_BEARER_TOKEN: string;
  X_API_ACCESS_TOKEN: string;
  X_API_ACCESS_TOKEN_SECRET: string;
  X_OAUTH_CLIENT_ID: string;
  X_OAUTH_CLIENT_SECRET?: string;
  X_OAUTH_REDIRECT_URI: string;
  X_OAUTH_SCOPES: string;
};

export const XAPIConfiguration = registerAs(
  "xapi",
  (): XAPIConfig => ({
    X_API_KEY: process.env.X_API_KEY ?? "",
    X_API_SECRET: process.env.X_API_SECRET ?? "",
    X_API_BEARER_TOKEN: process.env.X_API_BEARER_TOKEN ?? "",
    X_API_ACCESS_TOKEN: process.env.X_API_ACCESS_TOKEN ?? "",
    X_API_ACCESS_TOKEN_SECRET: process.env.X_API_ACCESS_TOKEN_SECRET ?? "",
    X_OAUTH_CLIENT_ID:
      process.env.X_OAUTH_CLIENT_ID ?? process.env.X_API_KEY ?? "",
    X_OAUTH_CLIENT_SECRET:
      process.env.X_OAUTH_CLIENT_SECRET ?? process.env.X_API_SECRET,
    X_OAUTH_REDIRECT_URI:
      process.env.X_OAUTH_REDIRECT_URI ??
      `${process.env.API_BASE_URL ?? "http://localhost:3000"}/api/v1/auth/x/callback`,
    X_OAUTH_SCOPES:
      process.env.X_OAUTH_SCOPES ??
      "tweet.read users.read dm.read dm.write offline.access",
  }),
);
