export interface FeedCursor {
  id: string;
  createdAt: number;
}

export function encodeFeedCursor(id: string, createdAt: Date): string {
  return Buffer.from(
    JSON.stringify({ v: 1, c: createdAt.getTime(), i: id }),
  ).toString('base64url');
}

export function decodeFeedCursor(cursor: string): FeedCursor | null {
  try {
    const value: unknown = JSON.parse(Buffer.from(cursor, 'base64url').toString('utf8'));
    if (!value || typeof value !== 'object') {
      return null;
    }

    const data = value as Record<string, unknown>;
    if (
      data.v !== 1
      || typeof data.i !== 'string'
      || !data.i
      || typeof data.c !== 'number'
      || !Number.isFinite(data.c)
    ) {
      return null;
    }

    return { id: data.i, createdAt: data.c };
  } catch {
    return null;
  }
}
