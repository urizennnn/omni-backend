import { registerAs } from "@nestjs/config";

function parseKey(value: string): Buffer {
  const decoded = Buffer.from(value, "base64");
  if (decoded.length !== 32) {
    throw new Error("MFA_SECRET_KEY must be a base64-encoded 32-byte key");
  }
  return decoded;
}

export const MfaConfiguration = registerAs("mfa", () => {
  const secret = process.env.MFA_SECRET_KEY;
  if (!secret) {
    throw new Error("MFA_SECRET_KEY is required");
  }

  return {
    encryptionKey: parseKey(secret),
  } as const;
});
