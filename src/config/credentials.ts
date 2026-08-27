import { getPassword, setPassword, deletePassword } from "cross-keychain";

const SERVICE = "tandem-mode";
const ACCOUNT = "deepseek-api-key";

export async function getStoredApiKey(): Promise<string | null> {
  return getPassword(SERVICE, ACCOUNT);
}

export async function setStoredApiKey(key: string): Promise<void> {
  await setPassword(SERVICE, ACCOUNT, key);
}

export async function deleteStoredApiKey(): Promise<void> {
  try {
    await deletePassword(SERVICE, ACCOUNT);
  } catch {
    // Već ne postoji — brisanje je idempotentno iz ugla pozivaoca.
  }
}
