import { createDecipheriv } from "crypto";

const MFA_SECRET_KEY = process.env.MFA_SECRET_KEY;
const token = process.argv[2];

if (!MFA_SECRET_KEY) {
  console.error("MFA_SECRET_KEY env var required");
  process.exit(1);
}

if (!token) {
  console.error("Usage: npx ts-node scripts/decrypt-token.ts <encrypted-token>");
  process.exit(1);
}

const key = Buffer.from(MFA_SECRET_KEY, "base64");
const parts = token.split(".");

if (parts.length !== 3) {
  console.error("Invalid token format. Expected: iv.data.authTag");
  process.exit(1);
}

const iv = Buffer.from(parts[0]!, "base64");
const data = Buffer.from(parts[1]!, "base64");
const authTag = Buffer.from(parts[2]!, "base64");

try {
  const decipher = createDecipheriv("aes-256-gcm", key, iv);
  decipher.setAuthTag(authTag);
  const decrypted = Buffer.concat([decipher.update(data), decipher.final()]);
  const result = decrypted.toString("utf8");

  try {
    console.log(JSON.stringify(JSON.parse(result), null, 2));
  } catch {
    console.log(result);
  }
} catch (e) {
  console.error("Decryption failed:", e instanceof Error ? e.message : e);
  process.exit(1);
}
