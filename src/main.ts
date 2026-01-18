import "./instruments";
import "reflect-metadata";
import { NestApplication, NestFactory, Reflector } from "@nestjs/core";
import { AppModule } from "./app.module";

import { RequestMethod, ValidationPipe, VersioningType } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import type { CorsConfig } from "./config/cors.config";
import type { LoggerConfig } from "./config/logger.config";
import { AllExceptionsFilter } from "./common/filters/all-exceptions.filter";
import { ResponseInterceptor } from "./common/interceptors/response.interceptor";
import { requestIdMiddleware } from "./common/middleware/request-id.middleware";
import { httpLoggerMiddleware } from "./common/middleware/http-logger.middleware";

async function bootstrap(): Promise<void> {
  const app = await NestFactory.create<NestApplication>(AppModule, {});

  const config = app.get(ConfigService);

  const cors = config.get<CorsConfig>("cors");
  if (cors?.enabled) {
    app.enableCors({
      origin: cors.origin,
      credentials: cors.credentials,
      methods: cors.methods,
    });
  }
  app.use(requestIdMiddleware);

  const logger = config.get<LoggerConfig>("logger");
  if (logger?.httpLogging?.enabled) {
    app.use(httpLoggerMiddleware);
  }

  app.useGlobalPipes(
    new ValidationPipe({
      transform: true,
      whitelist: true,
      forbidNonWhitelisted: false,
      validationError: { target: false },
    }),
  );

  app.useGlobalFilters(new AllExceptionsFilter());
  app.useGlobalInterceptors(new ResponseInterceptor(new Reflector()));

  app.setGlobalPrefix("api", {
    exclude: [{ path: "api-docs", method: RequestMethod.GET }],
  });
  app.enableVersioning({
    defaultVersion: "1",
    type: VersioningType.URI,
  });

  const port = Number(config.get("PORT")) || 3000;
  await app.listen(port);
  console.log(`Application is running on: ${await app.getUrl()}`);
}

void bootstrap();
