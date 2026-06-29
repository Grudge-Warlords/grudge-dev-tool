import Database from "better-sqlite3";

const dbPath = process.env.ANYTHINGLLM_DB
  ?? "C:/Users/david/AppData/Roaming/anythingllm-desktop/storage/anythingllm.db";

const db = new Database(dbPath, { readonly: true });
const tables = db.prepare("SELECT name FROM sqlite_master WHERE type='table'").all();
console.log("tables:", tables.map((t) => t.name).join(", "));

try {
  const keys = db.prepare("SELECT id, name, createdAt FROM api_keys").all();
  console.log("api_keys count:", keys.length);
  for (const k of keys) {
    console.log(`  id=${k.id} name=${k.name} created=${k.createdAt}`);
  }
} catch (e) {
  console.log("api_keys query failed:", e.message);
}

try {
  const settings = db.prepare("SELECT label, value FROM system_settings WHERE label LIKE '%api%' OR label LIKE '%port%'").all();
  console.log("settings:", JSON.stringify(settings, null, 2));
} catch (e) {
  console.log("settings query failed:", e.message);
}

db.close();