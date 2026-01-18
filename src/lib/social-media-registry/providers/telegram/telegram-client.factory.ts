import type { ConfigType } from "@nestjs/config";
import { TelegramConfiguration } from "@app/config/telegram.config";
import * as tdl from "tdl";
import { getTdjson } from "prebuilt-tdlib";
import { resolve } from "node:path";

tdl.configure({ tdjson: getTdjson() });

export const createTelegramClient = (
  config: ConfigType<typeof TelegramConfiguration>,
  databaseDirectory?: string,
): tdl.Client => {
  const sessionDir = resolve(databaseDirectory!);
  console.log("Telegram session directory:", sessionDir);
  const apiId = Number(config.apiId);
  if (!Number.isFinite(apiId) || apiId <= 0) {
    throw new Error("Invalid Telegram API id");
  }
  if (!config.apiHash) {
    throw new Error("Missing Telegram API hash");
  }

  const client = tdl.createClient({
    apiId: +config.apiId,
    apiHash: config.apiHash,

    useTestDc: false,
    tdlibParameters: {
      use_message_database: true,
      use_secret_chats: false,
      system_language_code: "en",
      application_version: "1.0",
      device_model: "tdlib",
      api_hash: config.apiHash,
      api_id: +config.apiId,
      use_chat_info_database: true,
      system_version: "node",
    },
    databaseDirectory: databaseDirectory || "_td_database",
  });

  return client;
};
