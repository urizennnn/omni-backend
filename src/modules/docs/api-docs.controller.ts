import {
  Controller,
  Get,
  Header,
  HttpCode,
  VERSION_NEUTRAL,
} from "@nestjs/common";
import { readFile } from "fs/promises";
import path from "path";

@Controller({ path: "api-docs", version: VERSION_NEUTRAL })
export class ApiDocsController {
  @Get()
  @HttpCode(200)
  @Header("Content-Type", "application/json; charset=utf-8")
  async getOpenApi(): Promise<string> {
    const filePath = path.resolve(process.cwd(), "openapi.json");
    const content = await readFile(filePath, "utf-8");
    return content;
  }
}
