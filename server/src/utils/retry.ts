/**
 * Small retry helper with exponential backoff and jitter.
 * Used for flaky free-tier endpoints (search providers especially).
 */
export async function retry<T>(
  fn: (attempt: number) => Promise<T>,
  attempts = 3,
  baseDelayMs = 400,
  label = "operation"
): Promise<T> {
  let lastError: unknown;

  for (let attempt = 1; attempt <= attempts; attempt++) {
    try {
      return await fn(attempt);
    } catch (err) {
      lastError = err;
      if (attempt === attempts) break;

      // Exponential backoff + up to 250ms of jitter so retries do not align.
      const delay = baseDelayMs * 2 ** (attempt - 1) + Math.floor(Math.random() * 250);
      await new Promise((resolve) => setTimeout(resolve, delay));
    }
  }

  throw lastError instanceof Error ? lastError : new Error(`${label} failed`);
}

export default retry;