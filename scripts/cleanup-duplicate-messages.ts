#!/usr/bin/env ts-node

import { MikroORM } from "@mikro-orm/core";
import mikroOrmConfig from "../mikro-orm.config";
import { MessageEntity } from "../src/entities/messages.entity";

async function cleanupDuplicateMessages() {
  const orm = await MikroORM.init(mikroOrmConfig);
  const em = orm.em.fork();

  try {
    console.log("Finding duplicate outbound messages...");

    const duplicates = await em.getConnection().execute(`
      SELECT
        external_message_id,
        conversation_id,
        COUNT(*) as count,
        ARRAY_AGG(id ORDER BY
          CASE
            WHEN status = 'delivered' THEN 1
            WHEN status = 'sent' THEN 2
            ELSE 3
          END,
          created_at DESC
        ) as message_ids
      FROM message
      WHERE direction = 'outbound'
      GROUP BY external_message_id, conversation_id
      HAVING COUNT(*) > 1
    `);

    if (duplicates.length === 0) {
      console.log("No duplicate messages found!");
      await orm.close();
      return;
    }

    console.log(`Found ${duplicates.length} sets of duplicate messages`);

    let totalDeleted = 0;

    for (const dup of duplicates) {
      const messageIds = dup.message_ids as string[];
      const keepId = messageIds[0];
      const deleteIds = messageIds.slice(1);

      console.log(
        `External ID ${dup.external_message_id}: Keeping ${keepId}, deleting ${deleteIds.length} duplicate(s)`,
      );

      await em.nativeDelete(MessageEntity, { id: { $in: deleteIds } });
      totalDeleted += deleteIds.length;
    }

    console.log(
      `\n✅ Cleanup complete! Deleted ${totalDeleted} duplicate messages.`,
    );
  } catch (error) {
    console.error("Error during cleanup:", error);
    throw error;
  } finally {
    await orm.close();
  }
}

cleanupDuplicateMessages()
  .then(() => {
    console.log("Script completed successfully");
    process.exit(0);
  })
  .catch((error) => {
    console.error("Script failed:", error);
    process.exit(1);
  });
