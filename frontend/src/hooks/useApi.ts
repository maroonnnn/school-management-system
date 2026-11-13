import { useCallback, useEffect, useState } from "react";
import { apiFetch } from "../services/api";

interface Result<T> {
  key: string;
  data: T | null;
  error: string;
}

/** GET `path` (skipped when null) → { data, loading, error, reload }. Keeps previous data while reloading. */
export function useApi<T>(path: string | null) {
  const [version, setVersion] = useState(0);
  const [result, setResult] = useState<Result<T>>({ key: "", data: null, error: "" });
  const key = path ? `${path}#${version}` : "";

  useEffect(() => {
    if (!path) return;
    let cancelled = false;
    apiFetch<{ data: T }>(path)
      .then((r) => !cancelled && setResult({ key, data: r.data, error: "" }))
      .catch((e: Error) => !cancelled && setResult({ key, data: null, error: e.message }));
    return () => {
      cancelled = true;
    };
  }, [path, key]);

  const reload = useCallback(() => setVersion((v) => v + 1), []);
  const samePath = path != null && result.key.startsWith(`${path}#`);
  return {
    data: samePath ? result.data : null,
    loading: !!path && result.key !== key,
    error: samePath ? result.error : "",
    reload,
  };
}
