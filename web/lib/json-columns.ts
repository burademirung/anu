/** Serialize a value for a TEXT-backed JSON column. null/undefined -> null. */
export function toJsonColumn(value: unknown): string | null {
  if (value === null || value === undefined) return null;
  return JSON.stringify(value);
}

/** Parse a TEXT-backed JSON column. null or malformed -> null (never throws). */
export function fromJsonColumn<T = unknown>(stored: string | null | undefined): T | null {
  if (stored === null || stored === undefined) return null;
  try {
    return JSON.parse(stored) as T;
  } catch {
    return null;
  }
}
