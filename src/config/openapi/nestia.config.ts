import { INestiaConfig } from "@nestia/sdk";

export default {
  input: {
    include: [
      "./src/modules/**/*.controller.ts",
      "./src/lib/**/*.controller.ts",
    ],
    exclude: [
      "./src/main.ts",
      "./src/common/**/*.ts",
      "./src/**/*api-docs.controller.ts",
    ],
  },
  swagger: {
    servers: [
      {
        url: "http://localhost:3000/api/v1",
        description: "Local Development",
      },
      {
        url: "https://staging-api.yourdomain.com/api/v1",
        description: "Staging Environment",
      },
      {
        url: "https://api.yourdomain.com/api/v1",
        description: "Production Environment",
      },
    ],
    openapi: "3.0",
    info: {
      title: "Omni-Backend API",
      version: "1.0.0",
    },
    output: "./openapi.json",
    beautify: true,
  },
} satisfies INestiaConfig;
