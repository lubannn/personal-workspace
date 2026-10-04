import { localDateInTimezone } from "./page-model";

// Align with minute boundaries rather than a minute after page mounting.
// Resume/background events also refresh immediately; this does no network I/O.
export function watchWorkspaceDate(timezone: string, onDate: (date: string) => void) {
  let timer: number;
  const update = () => {
    window.clearTimeout(timer);
    onDate(localDateInTimezone(timezone));
    timer = window.setTimeout(update, 60_000 - Date.now() % 60_000 + 10);
  };
  const resume = () => { if (document.visibilityState === "visible") update(); };
  update();
  window.addEventListener("focus", update);
  document.addEventListener("visibilitychange", resume);
  return () => {
    window.clearTimeout(timer);
    window.removeEventListener("focus", update);
    document.removeEventListener("visibilitychange", resume);
  };
}
