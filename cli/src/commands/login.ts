import { saveAuth } from "../lib/auth.js";

export async function runLogin(opts: {
  token?: string;
  adminPassword?: string;
  grudgeId?: string;
}): Promise<number> {
  if (!opts.token && !opts.adminPassword) {
    console.error("Provide --token or --admin-password (or set GRUDGE_AUTH_TOKEN / GRUDGE_ADMIN_PASSWORD)");
    return 1;
  }
  await saveAuth({
    token: opts.token,
    adminPassword: opts.adminPassword,
    grudgeId: opts.grudgeId,
  });
  console.log("Credentials saved (keytar or ~/.grudge-dev/auth.json)");
  return 0;
}