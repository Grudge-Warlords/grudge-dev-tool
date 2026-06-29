import keytar from "keytar";
import { argv } from "node:process";

const token = argv[2] ?? process.env.HUGGINGFACE_API_TOKEN;
if (!token?.startsWith("hf_")) {
  console.error("Usage: node scripts/store-hf-token.mjs <hf_token>");
  process.exit(2);
}
await keytar.setPassword("grudge-dev-tool", "ai.huggingface", token.trim());
console.log(`stored HuggingFace token (${token.length} chars) in Windows Credential Vault`);