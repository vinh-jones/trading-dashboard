import { useState, useEffect } from "react";
import { isMarketHours } from "../lib/trading";

export function useLiveVix(fallbackVix) {
  const [vix, setVix]       = useState(fallbackVix);
  const [source, setSource] = useState("manual");

  useEffect(() => {
    async function fetchVix() {
      try {
        const controller = new AbortController();
        const timeout    = setTimeout(() => controller.abort(), 5000);
        const r    = await fetch("/api/vix", { signal: controller.signal });
        clearTimeout(timeout);
        const data = await r.json();
        if (data.vix != null) {
          setVix(data.vix);
          setSource("live");
        } else {
          setSource(fallbackVix != null ? "manual" : "null");
        }
      } catch {
        setSource(fallbackVix != null ? "manual" : "null");
      }
    }

    fetchVix();

    const interval = setInterval(() => {
      if (isMarketHours()) fetchVix();
    }, 5 * 60 * 1000);

    return () => clearInterval(interval);
  }, []);

  return { vix, source };
}
