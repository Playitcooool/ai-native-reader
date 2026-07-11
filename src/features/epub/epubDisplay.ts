function withTimeout<T>(promise: Promise<T>, timeoutMs: number): Promise<T> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error("EPUB page timed out.")), timeoutMs);
    promise.then(
      (value) => { clearTimeout(timer); resolve(value); },
      (error) => { clearTimeout(timer); reject(error); },
    );
  });
}

export async function displayEpubStart(
  display: (target: string | number) => Promise<unknown>,
  savedCfi: string | null,
  fallbackSection: number,
  timeoutMs = 15_000,
): Promise<boolean> {
  if (savedCfi) {
    try {
      await withTimeout(display(savedCfi), timeoutMs);
      return true;
    } catch {
      // A stale CFI should not prevent the book from opening.
    }
  }
  await withTimeout(display(fallbackSection), timeoutMs);
  return false;
}
