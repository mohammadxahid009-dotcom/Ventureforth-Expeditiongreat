import { lazy, type ComponentType } from "react";

/**
 * Lazy-load a screen chunk with retries.
 *
 * A dropped mobile connection (or a stale chunk after a new deploy) makes the
 * dynamic import reject, which React rethrows during render and blanks the app
 * with the global error page. Retrying a couple of times — and reloading once
 * when the chunk simply no longer exists — keeps that from happening.
 */
export function lazyRetry<T extends ComponentType<unknown>>(
  factory: () => Promise<{ default: T }>,
  key: string,
) {
  return lazy(async () => {
    let lastError: unknown;
    for (let attempt = 0; attempt < 3; attempt++) {
      try {
        return await factory();
      } catch (cause) {
        lastError = cause;
        await new Promise((resolve) => setTimeout(resolve, 300 * (attempt + 1)));
      }
    }

    // The deployed chunk is gone (new release): reload once to pick up the
    // fresh asset manifest instead of showing an error screen.
    if (typeof window !== "undefined") {
      const flag = `chunk-reload:${key}`;
      if (!sessionStorage.getItem(flag)) {
        sessionStorage.setItem(flag, "1");
        window.location.reload();
        return { default: (() => null) as unknown as T };
      }
    }
    throw lastError;
  });
}
