import keytar from "keytar";

const SERVICE = "grudge-dev-tool";

/** Account names stored by scripts/import-secrets.mjs and scripts/set-secret.mjs. */
export const CF_ACCOUNTS = {
  // Worker-fronted R2
  workerUrl:      "cf-objectstore-worker-url",
  workerApiKey:   "cf-objectstore-api-key",
  // Direct S3-compatible R2
  endpoint:       "cf-r2-endpoint",
  bucket:         "cf-r2-bucket",
  bucketAssets:   "cf-r2-bucket-assets",
  bucketStore:    "cf-r2-bucket-objectstore",
  accessKeyId:    "cf-r2-access-key-id",
  secret:         "cf-r2-secret",
  region:         "cf-r2-region",
  publicUrl:      "cf-r2-public-url",
  publicR2Url:    "cf-r2-public-r2-url",
  // AI Gateway / Workers AI
  aiWorkersApi:   "cf-ai-workers-api",
  accountId:      "cf-account-id",
  aiGatewayId:    "cf-ai-gateway-id",
} as const;

export type CfAccount = keyof typeof CF_ACCOUNTS;

export async function readCf(account: CfAccount): Promise<string | null> {
  return keytar.getPassword(SERVICE, CF_ACCOUNTS[account]);
}

export async function writeCf(account: CfAccount, value: string): Promise<void> {
  await keytar.setPassword(SERVICE, CF_ACCOUNTS[account], value);
}

export async function clearCf(account: CfAccount): Promise<void> {
  await keytar.deletePassword(SERVICE, CF_ACCOUNTS[account]);
}

export interface CfCredentialsStatus {
  worker: { url: boolean; apiKey: boolean };
  direct: { endpoint: boolean; bucket: boolean; accessKeyId: boolean; secret: boolean };
  ai:     { token: boolean; accountId: boolean; gatewayId: boolean };
  publicCdn: string | null;
}

export async function getCfStatus(): Promise<CfCredentialsStatus> {
  const has = async (a: CfAccount) => Boolean(await readCf(a));
  const publicCdn = (await readCf("publicR2Url")) ?? (await readCf("publicUrl")) ?? null;
  return {
    worker: {
      url: await has("workerUrl"),
      apiKey: await has("workerApiKey"),
    },
    direct: {
      endpoint: await has("endpoint"),
      bucket: await has("bucket"),
      accessKeyId: await has("accessKeyId"),
      secret: await has("secret"),
    },
    ai: {
      token: await has("aiWorkersApi"),
      accountId: await has("accountId"),
      gatewayId: await has("aiGatewayId"),
    },
    publicCdn,
  };
}
