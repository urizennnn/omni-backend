import { registerAs } from "@nestjs/config";

export type ApplicationConfig = {
  nodeEnv: string;
  port: number;
  logLevel: string;
  apiBaseUrl: string;
  databaseUrl: string;
  superAdminEmail: string;
  superAdminFirstName: string;
  superAdminLastName: string;
  superAdminPhone: string;
};

export const ApplicationConfiguration = registerAs(
  "app",
  (): ApplicationConfig => ({
    nodeEnv: process.env.NODE_ENV || "development",
    port: parseInt(process.env.PORT ?? "3000", 10),
    logLevel: process.env.LOG_LEVEL || "debug",
    apiBaseUrl: process.env.API_BASE_URL || "",
    databaseUrl: process.env.DATABASE_URL || "",
    superAdminEmail: process.env.SUPERADMIN_EMAIL || "",
    superAdminFirstName: process.env.SUPERADMIN_LASTNAME || "",
    superAdminLastName: process.env.SUPERADMIN_FIRSTNAME || "",
    superAdminPhone: process.env.SUPERADMIN_PHONE || "",
  }),
);
