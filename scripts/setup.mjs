// Cross-platform first-run setup: creates .env from .env.example with a random organizer PIN and QR secret.
import { randomBytes, randomInt } from "node:crypto";
import { copyFileSync, existsSync, readFileSync, writeFileSync } from "node:fs";

if (existsSync(".env")) {
  console.log(".env already exists — leaving it unchanged.");
} else {
  copyFileSync(".env.example", ".env");
  const env = readFileSync(".env", "utf8")
    .replace(/^ORGANIZER_PIN=.*$/m, `ORGANIZER_PIN=${randomInt(10_000_000, 100_000_000)}`)
    .replace(/^QR_SECRET=.*$/m, `QR_SECRET=${randomBytes(32).toString("hex")}`);
  writeFileSync(".env", env);
  console.log("Created .env with a random ORGANIZER_PIN and QR_SECRET (see the file; it is git-ignored).");
}
