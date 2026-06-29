/**
 * Creates a Developer API key in AnythingLLM's sqlite DB (api_keys table)
 * and stores it in Windows Credential Vault for grudge-dev-tool.
 * Browser extension keys (brx-*) are NOT valid for /api/v1/* endpoints.
 */
import Database from "better-sqlite3";
import uuidAPIKey from "uuid-apikey";
import { execSync } from "node:child_process";

const DB_PATH =
  process.env.ANYTHINGLLM_DB ??
  "C:/Users/david/AppData/Roaming/anythingllm-desktop/storage/anythingllm.db";

const KEY_NAME = "Grudge Dev Tool";

const db = new Database(DB_PATH);
const existing = db.prepare("SELECT id, secret, name FROM api_keys").all();
if (existing.length > 0) {
  console.log(`api_keys already has ${existing.length} key(s); using first.`);
  const secret = existing[0].secret;
  db.close();
  storeVault(secret);
  verify(secret);
  process.exit(0);
}

const secret = uuidAPIKey.create().apiKey;
const now = new Date().toISOString();
db.prepare(
  "INSERT INTO api_keys (secret, name, createdBy, createdAt, lastUpdatedAt) VALUES (?, ?, NULL, ?, ?)"
).run(secret, KEY_NAME, now, now);
db.close();

console.log(`Created Developer API key "${KEY_NAME}" in AnythingLLM.`);
storeVault(secret);
verify(secret);

function storeVault(secret) {
  process.env.ANYTHINGLLM_API_KEY = secret;
  process.env.ANYTHINGLLM_BASE_URL = "http://localhost:3001";
  execSync("node scripts/set-secret.mjs ANYTHINGLLM_API_KEY", {
    stdio: "inherit",
    env: process.env,
  });
  process.env.ANYTHINGLLM_BASE_URL = "http://localhost:3001";
  execSync("node scripts/set-secret.mjs ANYTHINGLLM_BASE_URL", {
    stdio: "inherit",
    env: process.env,
  });
  process.env.ANYTHINGLLM_WORKSPACE_SLUG = "assistant-chats";
  execSync("node scripts/set-secret.mjs ANYTHINGLLM_WORKSPACE_SLUG", {
    stdio: "inherit",
    env: process.env,
  });
}

function verify(secret) {
  const res = execSync(
    `curl -s -H "Authorization: Bearer ${secret}" http://localhost:3001/api/v1/auth`,
    { encoding: "utf8" }
  );
  console.log("auth:", res.trim());
}