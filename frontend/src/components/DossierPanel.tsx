import type { GraphEdge, GraphNode } from "../types";

type ThreatTier = "Critical" | "High" | "Medium" | "Low";

const TIER_ORDER: ThreatTier[] = ["Critical", "High", "Medium", "Low"];

function tierFromNode(n: GraphNode): ThreatTier {
  const p = n.properties ?? {};

  const str = (p["risk_text"] ?? p["threat_level"] ?? "") as string;
  const s = String(str).toLowerCase();
  if (s.includes("critical")) return "Critical";
  if (s.includes("high")) return "High";
  if (s.includes("medium")) return "Medium";
  if (s.includes("low")) return "Low";

  const num = p["risk"] ?? p["abuse_score"] ?? p["abuseConfidenceScore"];
  if (typeof num === "number") {
    const score = Math.max(0, Math.min(100, num));
    if (score >= 85) return "Critical";
    if (score >= 70) return "High";
    if (score >= 40) return "Medium";
    return "Low";
  }

  return "Low";
}

function tierColor(t: ThreatTier) {
  switch (t) {
    case "Critical":
      return { bg: "bg-cyber-red/20", border: "border-cyber-red", text: "text-cyber-red" };
    case "High":
      return { bg: "bg-amber-400/10", border: "border-amber-300", text: "text-amber-300" };
    case "Medium":
      return { bg: "bg-accent/10", border: "border-accent", text: "text-accent" };
    case "Low":
    default:
      return { bg: "bg-dark-600", border: "border-dark-500", text: "text-dark-50" };
  }
}

function edgeNeighborLabels(node: GraphNode, edges: GraphEdge[], nodeMap: Map<string, GraphNode>) {
  const neighbors = new Set<string>();
  for (const e of edges) {
    if (e.source === node.id && nodeMap.has(e.target)) {
      neighbors.add(e.target);
    }
    if (e.target === node.id && nodeMap.has(e.source)) {
      neighbors.add(e.source);
    }
  }

  return Array.from(neighbors).map((id) => nodeMap.get(id)!).filter(Boolean);
}

export default function DossierPanel({
  node,
  nodes,
  edges,
}: {
  node: GraphNode | null;
  nodes: GraphNode[];
  edges: GraphEdge[];
}) {
  const nodeMap = new Map(nodes.map((n) => [n.id, n] as const));

  if (!node) {
    return (
      <div className="h-full flex items-center justify-center text-dark-500 text-sm">
        Right-click a node → Search Around to grow the graph.
      </div>
    );
  }

  const tier = tierFromNode(node);
  const tc = tierColor(tier);
  const neighbors = edgeNeighborLabels(node, edges, nodeMap);

  const propsEntries = Object.entries(node.properties ?? {}).filter(([k, v]) => {
    if (k === "source") return false;
    if (v == null) return false;
    if (Array.isArray(v) && v.length === 0) return false;
    return true;
  });

  return (
    <div className="h-full flex flex-col">
      <div className="text-xs font-bold text-accent mb-3">Dossier View</div>

      <div className="bg-dark-800/60 border border-dark-600 rounded-lg p-3">
        {/* Identity */}
        <div className="flex items-start justify-between gap-3">
          <div>
            <div className="text-lg font-extrabold text-dark-50 leading-tight">
              {node.label}
            </div>
            <div className="mt-2 flex flex-wrap gap-2">
              <span className="px-2 py-1 rounded border border-accent/40 bg-accent/10 text-xs text-accent">
                {node.type}
              </span>
              <span
                className={`px-2 py-1 rounded border text-xs ${tc.bg} ${tc.border} ${tc.text} `}
              >
                {tier}
              </span>
            </div>
          </div>

          <div className="text-[11px] text-dark-500 break-all max-w-[40%]">
            {node.id}
          </div>
        </div>

        {/* Neighbors */}
        <div className="mt-3">
          <div className="text-sm font-bold text-dark-50 mb-2">Relational Neighbors</div>
          {neighbors.length === 0 ? (
            <div className="text-dark-500 text-sm">No neighbors found in current graph.</div>
          ) : (
            <div className="flex flex-wrap gap-2">
              {neighbors.slice(0, 12).map((n) => (
                <div key={n.id} className="px-2 py-1 rounded border border-dark-600 bg-dark-900/30 text-[11px]">
                  <span className="text-dark-500">{n.type}:</span> {n.label}
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Metadata */}
        <div className="mt-3">
          <div className="text-sm font-bold text-dark-50 mb-2">Metadata</div>
          {propsEntries.length === 0 ? (
            <div className="text-dark-500 text-sm">No metadata available.</div>
          ) : (
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
              {propsEntries.slice(0, 16).map(([k, v]) => {
                const value = Array.isArray(v) ? v.slice(0, 4).join(", ") : String(v);
                return (
                  <div key={k} className="rounded border border-dark-600 bg-dark-900/30 p-2">
                    <div className="text-[11px] text-dark-500">{k}</div>
                    <div className="text-[12px] text-dark-50 break-words">{value}</div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </div>

      <div className="mt-3 text-[11px] text-dark-500">
        Dossier is generated client-side from the current active graph.
      </div>
    </div>
  );
}

