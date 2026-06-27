import { useState, useCallback } from "react";
import type { InvestigationPayload } from "./types";

interface UseInvestigationReturn {
  loading: boolean;
  error: string | null;
  data: InvestigationPayload | null;
  investigate: (query: string) => Promise<void>;
  clear: () => void;
}

export function useInvestigation(): UseInvestigationReturn {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [data, setData] = useState<InvestigationPayload | null>(null);

  const investigate = useCallback(async (query: string) => {
    if (!query.trim()) return;

    setLoading(true);
    setError(null);
    setData(null);

    try {
      const url = `/api/investigate?query=${encodeURIComponent(query.trim())}`;
      const res = await fetch(url, { method: "POST" });

      if (!res.ok) {
        const body = await res.text();
        throw new Error(`Server ${res.status}: ${body.slice(0, 200)}`);
      }

      const json: InvestigationPayload = await res.json();
      setData(json);
    } catch (err) {
      const msg =
        err instanceof Error ? err.message : "Unknown fetch error";
      setError(msg);
    } finally {
      setLoading(false);
    }
  }, []);

  const clear = useCallback(() => {
    setData(null);
    setError(null);
  }, []);

  return { loading, error, data, investigate, clear };
}
