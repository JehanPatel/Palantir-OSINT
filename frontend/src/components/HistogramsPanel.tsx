import type { GraphEdge, GraphNode } from "../types";
import { useMemo } from "react";

type ThreatTier = "Critical" | "High" | "Medium" | "Low";

const TIER_ORDER: ThreatTier[] = ["Critical", "High", "Medium", "Low"];

function tierFromNode(n: GraphNode): ThreatTier {
  // Heuristic: try common risk/score properties.
  const p = n.properties ?? {};

  const candidates: unknown[] = [
    p["risk"],
    p["abuse_score"],
    p["abuseConfidenceScore"],
    p["severity"],
    p["threat_level"],
    p["risk_text"],
  ];

  const str = candidates.find((c) => typeof c === "string") as string | undefined;
  if (str) {
    const s = str.toLowerCase();
    if (s.includes("critical")) return "Critical";
    if (s.includes("high")) return "High";
    if (s.includes("medium")) return "Medium";
    if (s.includes("low")) return "Low";
  }

  const num = candidates.find((c) => typeof c === "number") as number | undefined;
  if (typeof num === "number") {
    // Normalize common ranges.
    // AbuseIPDB abuseConfidenceScore is 0..100.
    const score = Math.max(0, Math.min(100, num));
    if (score >= 85) return "Critical";
    if (score >= 70) return "High";
    if (score >= 40) return "Medium";
    return "Low";
  }

  return "Low";
}

function clamp01(x: number) {
  return Math.max(0, Math.min(1, x));
}

export default function HistogramsPanel({
  nodes,
  edges,
  activeType,
  activeTier,
  onTypeFilter,
  onTierFilter,
}: {
  nodes: GraphNode[];
  edges: GraphEdge[];
  activeType: GraphNode["type"] | "All";
  activeTier: ThreatTier | "All";
  onTypeFilter: (t: GraphNode["type"] | "All") => void;
  onTierFilter: (t: ThreatTier | "All") => void;
}) {
  const types = useMemo(() => {
    const map = new Map<string, number>();
    for (const n of nodes) map.set(n.type, (map.get(n.type) ?? 0) + 1);
    return Array.from(map.entries())
      .map(([type, count]) => ({ type, count }))
      .sort((a, b) => b.count - a.count);
  }, [nodes]);

  const tiers = useMemo(() => {
    const map = new Map<ThreatTier, number>([
      ["Critical", 0],
      ["High", 0],
      ["Medium", 0],
      ["Low", 0],
    ]);
    for (const n of nodes) {
      const t = tierFromNode(n);
      map.set(t, (map.get(t) ?? 0) + 1);
    }
    return TIER_ORDER.map((t) => ({ tier: t, count: map.get(t) ?? 0 }));
  }, [nodes]);

  const maxType = Math.max(1, ...types.map((t) => t.count));
  const maxTier = Math.max(1, ...tiers.map((t) => t.count));

  return (
    <div className="w-full max-w-xl">
      <div className="mb-3">
        <div className="text-xs font-bold text-accent mb-2">Node type histogram</div>
        <button
          type="button"
          onClick={() => onTypeFilter("All")}
          className={
            "w-full mb-2 text-left text-[12px] px-2 py-1 rounded border " +
            (activeType === "All"
              ? "border-accent bg-accent/10"
              : "border-dark-600 bg-dark-800/30 hover:bg-dark-800/60")
          }
        >
          All types ({nodes.length})
        </button>

        <div className="space-y-2">
          {types.map((t) => {
            const pct = clamp01(t.count / maxType);
            return (
              <button
                key={t.type}
                type="button"
                onClick={() => onTypeFilter(t.type as GraphNode["type"])}
                className={
                  "w-full text-left text-[12px] px-2 py-1 rounded border " +
                  (activeType === t.type
                    ? "border-accent bg-accent/10"
                    : "border-dark-600 bg-dark-800/30 hover:bg-dark-800/60")
                }
              >
                <div className="flex items-center justify-between mb-1">
                  <span className="text-dark-50">{t.type}</span>
                  <span className="text-dark-500">{t.count}</span>
                </div>
                <div className="h-2 bg-dark-600 rounded overflow-hidden">
                  <div
                    className="h-full bg-accent"
                    style={{ width: `${pct * 100}%` }}
                  />
                </div>
              </button>
            );
          })}
        </div>
      </div>

      <div>
        <div className="text-xs font-bold text-accent mb-2">Threat tier distribution</div>
        <button
          type="button"
          onClick={() => onTierFilter("All")}
          className={
            "w-full mb-2 text-left text-[12px] px-2 py-1 rounded border " +
            (activeTier === "All"
              ? "border-accent bg-accent/10"
              : "border-dark-600 bg-dark-800/30 hover:bg-dark-800/60")
          }
        >
          All tiers ({nodes.length})
        </button>

        <div className="space-y-2">
          {tiers.map((t) => {
            const pct = clamp01(t.count / maxTier);
            return (
              <button
                key={t.tier}
                type="button"
                onClick={() => onTierFilter(t.tier)}
                className={
                  "w-full text-left text-[12px] px-2 py-1 rounded border " +
                  (activeTier === t.tier
                    ? "border-accent bg-accent/10"
                    : "border-dark-600 bg-dark-800/30 hover:bg-dark-800/60")
                }
              >
                <div className="flex items-center justify-between mb-1">
                  <span className="text-dark-50">{t.tier}</span>
                  <span className="text-dark-500">{t.count}</span>
                </div>
                <div className="h-2 bg-dark-600 rounded overflow-hidden">
                  <div
                    className="h-full bg-accent"
                    style={{ width: `${pct * 100}%` }}
                  />
                </div>
              </button>
            );
          })}
        </div>
      </div>

      <div className="mt-3 text-[11px] text-dark-500">
        Histogram data is computed locally from node properties (risk/score heuristics).
      </div>
    </div>
  );
}

