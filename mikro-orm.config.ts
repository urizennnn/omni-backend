import { defineConfig } from "@mikro-orm/postgresql";
import { TsMorphMetadataProvider } from "@mikro-orm/reflection";
import { Envrionment } from "./src/config/validate-env-from";
import "dotenv/config";

export default defineConfig({
  metadataProvider: TsMorphMetadataProvider,
  clientUrl: process.env.DATABASE_URL,
  dbName: process.env.DB_NAME,
  driverOptions: {
    connection: {
      ssl:
        process.env.NODE_ENV === Envrionment.Production
          ? { rejectUnauthorized: true }
          : false,
    },
  },

  entities: ["dist/**/*.entity.js"],
  entitiesTs: ["./src/**/*.entity.ts"],
  migrations: {
    tableName: "mikro_orm_migrations",
    path: "migrations",
    pathTs: "migrations",
    disableForeignKeys: false,
  },
  debug: process.env.NODE_ENV !== "production",
});
