import keytar from "keytar";

const SERVICE = "grudge-dev-tool";
const KEY_NAME = "sketchfab-api-key";

export async function getApiKey(): Promise<string | null> {
  const stored = await keytar.getPassword(SERVICE, KEY_NAME);
  return stored || process.env.SKETCHFAB_API_KEY || null;
}

export async function setApiKey(key: string): Promise<void> {
  await keytar.setPassword(SERVICE, KEY_NAME, key);
}

export async function clearApiKey(): Promise<void> {
  await keytar.deletePassword(SERVICE, KEY_NAME);
}