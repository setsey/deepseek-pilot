// Simple JSON-safe helpers
export function tryParseJson(text: string): unknown {
  try { return JSON.parse(text); } catch { return null; }
}

export function safeJsonStringify(obj: unknown): string {
  try { return JSON.stringify(obj); } catch { return '{}'; }
}
