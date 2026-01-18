import { Module } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { MikroOrmModule } from "@mikro-orm/nestjs";
import { PostgreSqlDriver } from "@mikro-orm/postgresql";
import { Envrionment } from "@app/config/validate-env-from";

@Module({
  imports: [
    MikroOrmModule.forRootAsync({
      inject: [ConfigService],
      useFactory: (config: ConfigService) => ({
        clientUrl: config.get<string>("DATABASE_URL"),
        discovery: { warnWhenNoEntities: false },
        driver: PostgreSqlDriver,
        entities: ["dist/**/*.entity.js"],
        allowGlobalContext: true,
        driverOptions: {
          connection: {
            ssl:
              config.get("NODE_ENV") === Envrionment.Production
                ? { rejectUnauthorized: true }
                : false,
          },
        },
        entitiesTs: ["./src/**/*.entity.ts"],
        // debug: config.get("NODE_ENV") !== "production",
        migrations: {
          tableName: "mikro_orm_migrations",
          path: "migrations",
          pathTs: "migrations",
          disableForeignKeys: false,
        },
      }),
    }),
  ],
  providers: [],
  exports: [],
})
export class DatabaseModule {}
