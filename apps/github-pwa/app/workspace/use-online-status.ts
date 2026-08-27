"use client";

import { useEffect, useState } from "react";

export function useOnlineStatus(onCleanup: () => void) {
  const [online, setOnline] = useState<boolean | null>(null);

  useEffect(() => {
    const update = () => setOnline(navigator.onLine);
    update();
    window.addEventListener("online", update);
    window.addEventListener("offline", update);
    return () => {
      window.removeEventListener("online", update);
      window.removeEventListener("offline", update);
      onCleanup();
    };
  }, [onCleanup]);

  return online;
}
