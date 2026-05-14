/** Thin wrapper — crypto.randomUUID available in all modern browsers (Chrome 92+, FF 95+, Safari 15.4+). */
export function randomUUID(): string {
  return crypto.randomUUID();
}
