import keytar from "keytar";
import { execSync } from "node:child_process";

const key = await keytar.getPassword("grudge-dev-tool", "grudachain.anythingllmApiKey");
if (!key) {
  console.error("No API key in vault");
  process.exit(1);
}

const workspaces = execSync(
  `curl -s -H "Authorization: Bearer ${key}" http://localhost:3001/api/v1/workspaces`,
  { encoding: "utf8" }
);
console.log("workspaces:", workspaces.trim());

const slug = "assistant-chats";
const chat = execSync(
  `curl -s -X POST -H "Authorization: Bearer ${key}" -H "Content-Type: application/json" -d "{\\"message\\":\\"ping\\",\\"mode\\":\\"chat\\"}" http://localhost:3001/api/v1/workspace/${slug}/chat`,
  { encoding: "utf8" }
);
console.log("chat:", chat.trim().slice(0, 500));