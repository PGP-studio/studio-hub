import { useCallback, useEffect, useRef, useState } from "react";

/**
 * Run `load` now, then every `ms` while the tab is visible (and again when it becomes visible).
 * `refresh()` reloads immediately, e.g. right after your own edit.
 * `patch()` changes the local copy at once so edits feel instant before GitHub answers.
 */
export function usePoll<T>(load: (() => Promise<T>) | null, ms: number, key: string) {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loadedAt, setLoadedAt] = useState<Date | null>(null);
  const loadRef = useRef(load);
  loadRef.current = load;
  const run = useRef(0);

  const refresh = useCallback(async () => {
    const fn = loadRef.current;
    if (!fn) return;
    const mine = ++run.current;
    try {
      const d = await fn();
      if (mine !== run.current) return; // a newer load started; drop this one
      setData(d);
      setError(null);
      setLoadedAt(new Date());
    } catch (e) {
      if (mine === run.current) setError(e instanceof Error ? e.message : String(e));
    }
  }, []);

  useEffect(() => {
    setData(null);
    if (!loadRef.current) return;
    refresh();
    const timer = setInterval(() => {
      if (document.visibilityState === "visible") refresh();
    }, ms);
    const onVis = () => document.visibilityState === "visible" && refresh();
    document.addEventListener("visibilitychange", onVis);
    return () => {
      clearInterval(timer);
      document.removeEventListener("visibilitychange", onVis);
    };
  }, [key, ms, refresh]);

  const patch = useCallback((fn: (d: T) => T) => setData((d) => (d == null ? d : fn(d))), []);
  return { data, error, loadedAt, refresh, patch };
}
