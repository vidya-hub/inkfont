import { useEffect, useState } from "react";
import { flushSave, useDocument } from "../core/store";
export function Offline() {
  const [waiting, setWaiting] = useState<ServiceWorker | null>(null),
    [offline, setOffline] = useState(!navigator.onLine);
  useEffect(() => {
    const online = () => setOffline(!navigator.onLine);
    window.addEventListener("online", online);
    window.addEventListener("offline", online);
    if (import.meta.env.PROD && "serviceWorker" in navigator) {
      void navigator.serviceWorker
        .register("/sw.js")
        .then((reg) => {
          if (reg.waiting) setWaiting(reg.waiting);
          reg.addEventListener("updatefound", () => {
            const worker = reg.installing;
            worker?.addEventListener("statechange", () => {
              if (
                worker.state === "installed" &&
                navigator.serviceWorker.controller
              )
                setWaiting(worker);
            });
          });
        })
        .catch(() => {});
    }
    return () => {
      window.removeEventListener("online", online);
      window.removeEventListener("offline", online);
    };
  }, []);
  return (
    <>
      {offline && (
        <div className="offline-status">
          Offline · editing and local saving are available.
        </div>
      )}
      {waiting && (
        <div className="offline-status">
          An update is ready.
          <button
            onClick={async () => {
              await flushSave();
              if (useDocument.getState().status !== "saved") return;
              navigator.serviceWorker.addEventListener(
                "controllerchange",
                () => location.reload(),
                { once: true },
              );
              waiting.postMessage("ACTIVATE");
            }}
          >
            Save & update
          </button>
        </div>
      )}
    </>
  );
}
