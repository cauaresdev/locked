import * as SecureStore from 'expo-secure-store';

const TOKEN_KEY = 'knightfall_token';

// Kept in memory after the first read so every request doesn't hit the keychain.
let cached: string | null | undefined;

export function getToken(): string | null {
  if (cached === undefined) cached = SecureStore.getItem(TOKEN_KEY);
  return cached;
}

export function setToken(token: string): void {
  cached = token;
  SecureStore.setItem(TOKEN_KEY, token);
}

export async function clearToken(): Promise<void> {
  cached = null;
  await SecureStore.deleteItemAsync(TOKEN_KEY);
}

type Listener = () => void;
const listeners = new Set<Listener>();

/** Fired when the server rejects the token (expired / revoked). */
export function onUnauthorized(fn: Listener): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

export function emitUnauthorized(): void {
  listeners.forEach((fn) => fn());
}
