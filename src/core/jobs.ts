import { runTask } from "./tasks";
let nextId = 0;
function local<T>(
  operation: string,
  payload: unknown,
  signal?: AbortSignal,
): Promise<T> {
  if (signal?.aborted)
    return Promise.reject(new DOMException("Cancelled", "AbortError"));
  return Promise.resolve().then(() => runTask(operation, payload) as T);
}
export function runJob<T>(
  operation: string,
  payload: unknown,
  revision: number,
  signal?: AbortSignal,
): Promise<T> {
  if (typeof navigator !== "undefined" && navigator.onLine === false)
    return local<T>(operation, payload, signal);
  return new Promise((resolve, reject) => {
    let worker: Worker;
    try {
      worker = new Worker(new URL("./worker.ts", import.meta.url), {
        type: "module",
      });
    } catch {
      void local<T>(operation, payload, signal).then(resolve, reject);
      return;
    }
    const id = ++nextId;
    const cleanup = () => {
      worker.terminate();
      signal?.removeEventListener("abort", abort);
    };
    const abort = () => {
      cleanup();
      reject(new DOMException("Cancelled", "AbortError"));
    };
    if (signal?.aborted) {
      abort();
      return;
    }
    signal?.addEventListener("abort", abort, { once: true });
    worker.onmessage = (e) => {
      if (e.data.id !== id || e.data.revision !== revision) return;
      cleanup();
      if (e.data.error) reject(new Error(e.data.error));
      else resolve(e.data.result);
    };
    worker.onerror = () => {
      cleanup();
      void local<T>(operation, payload, signal).then(resolve, reject);
    };
    worker.postMessage({ id, revision, operation, payload });
  });
}
