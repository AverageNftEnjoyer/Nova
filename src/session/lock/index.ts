const lockTails = new Map<string, Promise<void>>();

export async function acquireLock(sessionKey: string): Promise<() => void> {
  const normalizedKey = sessionKey.trim();
  const previousTail = lockTails.get(normalizedKey) ?? Promise.resolve();

  let releaseCurrent: (() => void) | null = null;
  const current = new Promise<void>((resolve) => {
    releaseCurrent = resolve;
  });

  const nextTail = previousTail.then(() => current);
  lockTails.set(normalizedKey, nextTail);
  await previousTail;

  let released = false;
  const release = () => {
    if (released) return;
    released = true;
    releaseCurrent?.();
    void nextTail.finally(() => {
      if (lockTails.get(normalizedKey) === nextTail) {
        lockTails.delete(normalizedKey);
      }
    });
  };

  return release;
}