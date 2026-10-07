export async function confirmApp(message: string): Promise<boolean> {
  return await window.grudge.appNative.request("confirm", message) === true;
}
export async function promptApp(message: string, value = ""): Promise<string | null> {
  const result = await window.grudge.appNative.request("text", message, value);
  return typeof result === "string" ? result : null;
}
