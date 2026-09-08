import { runTask } from "./tasks";
self.onmessage = (event: MessageEvent) => {
  const { id, revision, operation, payload } = event.data;
  try {
    self.postMessage({ id, revision, result: runTask(operation, payload) });
  } catch (error) {
    self.postMessage({ id, revision, error: (error as Error).message });
  }
};
