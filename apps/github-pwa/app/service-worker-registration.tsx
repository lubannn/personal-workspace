"use client";

import { useEffect } from "react";

export function ServiceWorkerRegistration() {
  useEffect(() => {
    if (!("serviceWorker" in navigator)) return;
    void navigator.serviceWorker.register("/sw.js", { scope: "/" }).catch(() => {
      // Reminder UI reports unsupported delivery separately; workspace reads and writes remain available.
    });
  }, []);
  return null;
}
