import { useCallback, useEffect, useRef, useState } from "react";

const HOLD_MS = 20_000;

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
  // GitHub Projects reads can lag a few seconds behind writes, so a poll right after an
  // edit may still return the old value. Local patches are re-applied on top of loads
  // for HOLD_MS so your own edits don't flicker back.
  const held = useRef<{ fn: (d: T) => T; until: number }[]>([]);
  const withHeld = (d: T) => {
    const now = Date.now();
    held.current = held.current.filter((p) => p.until > now);
    return held.current.reduce((acc, p) => p.fn(acc), d);
  };

  const refresh = useCallback(async () => {
    const fn = loadRef.current;
    if (!fn) return;
    const mine = ++run.current;
    try {
      const d = await fn();
      if (mine !== run.current) return; // a newer load started; drop this one
      setData(withHeld(d));
      setError(null);
      setLoadedAt(new Date());
    } catch (e) {
      if (mine === run.current) setError(e instanceof Error ? e.message : String(e));
    }
  }, []);

  useEffect(() => {
    setData(null);
    held.current = [];
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

  const patch = useCallback((fn: (d: T) => T) => {
    held.current.push({ fn, until: Date.now() + HOLD_MS });
    setData((d) => (d == null ? d : fn(d)));
  }, []);
  /** Forget local patches (e.g. after a failed write) so the next load shows GitHub's truth. */
  const dropPatches = useCallback(() => {
    held.current = [];
  }, []);
  return { data, error, loadedAt, refresh, patch, dropPatches };
}
