import { type FC, useEffect, useMemo, useState } from "react";
import { useInvestigation } from "./useInvestigation";
import GraphPanel from "./components/GraphPanel";
import HistogramsPanel from "./components/HistogramsPanel";
import DossierPanel from "./components/DossierPanel";
import type { GraphEdge, GraphNode } from "./types";

type ThreatTier = "Critical" | "High" | "Medium" | "Low";

type GraphData = { nodes: GraphNode[]; edges: GraphEdge[] };

const SPLIT_RATIO_KEY = "palantir-split-ratio";

function uniqueMerge(prev: GraphData, incoming: GraphData): GraphData {
  const nodeMap = new Map(prev.nodes.map((n) => [n.id, n] as const));
  for (const n of incoming.nodes) nodeMap.set(n.id, n);

  const edgeMap = new Map(prev.edges.map((e) => [e.id, e] as const));
  for (const e of incoming.edges) edgeMap.set(e.id, e);

  return { nodes: Array.from(nodeMap.values()), edges: Array.from(edgeMap.values()) };
}

function randFrom<T>(arr: T[], seed: number) {
  if (arr.length === 0) throw new Error("empty");
  const i = Math.abs(seed) % arr.length;
  return arr[i];
}

function mockSearchAround(entityId: string): Promise<GraphData> {
  // Entirely client-side: simulate an async "endpoint".

  return new Promise((resolve) => {
    setTimeout(() => {
      const seed = Array.from(entityId).reduce((acc, c) => acc + c.charCodeAt(0), 0);

      const nodeTypes: GraphNode["type"][] = [
        "Event",
        "ThreatActor",
        "Indicator",
        "Vulnerability",
        "Location",
        "Organization",
      ];

      const labelsA = ["Suspicious Activity", "Recon Findings", "Malicious Indicator", "Observed Incident", "Geolocation Match"];
      const labelsB = ["APT Activity", "Indicator Pulse", "Threat Actor", "IP Association", "Target Organization"];

      const newNodeCount = 24 + (seed % 7); // 24..30

      const newNodes: GraphNode[] = [];
      const newEdges: GraphEdge[] = [];

      const makeNode = (idx: number): GraphNode => {
        const type = randFrom(nodeTypes, seed + idx);
        const label = `${randFrom(labelsA, seed + idx)} (${type})`;

        const threatTier: ThreatTier =
          seed % 4 === 0 ? "Critical" : seed % 4 === 1 ? "High" : seed % 4 === 2 ? "Medium" : "Low";

        const riskNum =
          threatTier === "Critical" ? 92 : threatTier === "High" ? 76 : threatTier === "Medium" ? 55 : 20;

        return {
          id: `${entityId}-sa-${idx}`,
          label,
          type,
          latitude: type === "Location" ? 51 + (idx % 7) : null,
          longitude: type === "Location" ? 10 + (idx % 9) : null,
          properties: {
            source: "mock-search-around",
            risk: riskNum,
            risk_text: threatTier,
            severity: threatTier,
            timestamp: new Date(Date.now() - idx * 3600_000).toISOString(),
          },
        };
      };

      for (let i = 0; i < newNodeCount; i++) newNodes.push(makeNode(i));

      const edgeLabels: GraphEdge["label"][] = [
        "MENTIONS",
        "CORRELATES_WITH",
        "ATTACKED",
        "CONTROLS",
        "ORIGINATES_FROM",
        "LOCATED_IN",
      ];

      const sourceId = entityId;
      newNodes.slice(0, 10).forEach((n, idx) => {
        const edgeId = `sa-edge-${entityId}-${idx}`;
        newEdges.push({
          id: edgeId,
          source: sourceId,
          target: n.id,
          label: randFrom(edgeLabels, seed + idx),
          properties: { source: "mock-search-around" },
        });
      });

      // Connect a few neighbors among themselves.
      for (let i = 0; i < Math.min(4, newNodes.length - 1); i++) {
        const a = newNodes[i];
        const b = newNodes[i + 1];
        const edgeId = `sa-edge-internal-${entityId}-${i}`;
        newEdges.push({
          id: edgeId,
          source: a.id,
          target: b.id,
          label: randFrom(edgeLabels, seed + 100 + i),
          properties: { source: "mock-search-around" },
        });
      }

      resolve({ nodes: newNodes, edges: newEdges });
    }, 650);
  });
}

const App: FC = () => {
  const { loading, error, data, investigate } = useInvestigation();

  const [graphData, setGraphData] = useState<GraphData>({ nodes: [], edges: [] });
  const [selectedNode, setSelectedNode] = useState<GraphNode | null>(null);
  const [searchAroundBusy, setSearchAroundBusy] = useState(false);

  const [activeType, setActiveType] = useState<GraphNode["type"] | "All">("All");
  const [activeTier, setActiveTier] = useState<ThreatTier | "All">("All");

  // Initialize graph when the initial backend response arrives.
  useEffect(() => {
    if (!data) return;
    setGraphData({ nodes: data.nodes, edges: data.edges });
    setSelectedNode(null);
    setActiveType("All");
    setActiveTier("All");
  }, [data]);

  const nodeMap = useMemo(() => new Map(graphData.nodes.map((n) => [n.id, n] as const)), [graphData.nodes]);

  const applyFilters = useMemo(() => {
    // Hide/opacity logic is applied inside GraphPanel via class/op changes.
    // But GraphPanel currently does not expose imperative methods.
    // So we filter arrays and pass only the matching nodes/edges.

    let nodes = graphData.nodes;

    if (activeType !== "All") {
      nodes = nodes.filter((n) => n.type === activeType);
    }

    if (activeTier !== "All") {
      nodes = nodes.filter((n) => {
        const p = n.properties ?? {};
        const tier = (p["risk_text"] ?? p["severity"] ?? "") as string;
        const s = String(tier).toLowerCase();
        return s === activeTier.toLowerCase();
      });
    }

    const nodeIdSet = new Set(nodes.map((n) => n.id));
    const edges = graphData.edges.filter((e) => nodeIdSet.has(e.source) && nodeIdSet.has(e.target));

    return { nodes, edges };
  }, [graphData, activeTier, activeType]);

  const handleSelectNode = (node: GraphNode) => {
    setSelectedNode(node);
  };

  const handleSearchAround = async (nodeId: string) => {
    if (searchAroundBusy) return;
    setSearchAroundBusy(true);
    try {
      const incoming = await mockSearchAround(nodeId);
      setGraphData((prev) => uniqueMerge(prev, incoming));
    } finally {
      setSearchAroundBusy(false);
    }
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (query.trim()) investigate(query.trim());
  };

  const [query, setQuery] = useState("");

  return (
    <div className="h-screen w-screen flex flex-col bg-dark-900 overflow-hidden">
      <header className="h-12 flex-shrink-0 flex items-center px-4 bg-dark-800 border-b border-dark-600 gap-4">
        <div className="flex items-center gap-2 text-accent font-bold text-sm tracking-wider select-none">
          <span className="text-lg">&#x25C6;</span>
          <span>PALANTIR OSINT</span>
        </div>

        <form
          onSubmit={(e) => {
            e.preventDefault();
            if (query.trim()) investigate(query.trim());
          }}
          className="flex-1 flex gap-2 max-w-xl"
        >
          <input
            type="text"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Seed query — IP, domain, org, country, city, keyword..."
            className="flex-1 px-3 py-1.5 rounded bg-dark-700 border border-dark-500 text-sm text-white placeholder-dark-500 outline-none focus:border-accent focus:shadow-[0_0_8px_#00e5a040] transition-all"
          />
          <button
            type="submit"
            disabled={loading || !query.trim()}
            className="px-4 py-1.5 rounded bg-accent text-dark-900 text-sm font-bold hover:bg-accent-dim disabled:opacity-30 disabled:cursor-not-allowed transition-all"
          >
            {loading ? (
              <span className="flex items-center gap-1">
                <span className="inline-block w-3 h-3 border-2 border-dark-900 border-t-transparent rounded-full animate-spin" />
                SEARCHING
              </span>
            ) : (
              "INVESTIGATE"
            )}
          </button>
        </form>
      </header>

      {/* Main 3-column layout: Graph + Histograms + Dossier */}
      <div className="flex-1 overflow-hidden flex">
        <div className="flex-1 overflow-hidden">
          {error && (
            <div className="px-3 py-1.5 bg-cyber-red/20 border-b border-cyber-red/40 text-cyber-red text-xs">
              Error: {error}
            </div>
          )}

          {data ? (
            <div className="h-full">
              <GraphPanel
                nodes={applyFilters.nodes}
                edges={applyFilters.edges}
                onSelectNode={(n) => handleSelectNode(n)}
                onSearchAround={(id) => handleSearchAround(id)}
              />

              {searchAroundBusy && (
                <div className="absolute left-4 bottom-4 text-[11px] text-dark-500 bg-dark-800/70 border border-dark-600 rounded px-3 py-1">
                  Search Around running…
                </div>
              )}
            </div>
          ) : (
            <div className="h-full flex items-center justify-center text-dark-500 text-sm">
              {loading ? (
                <div className="flex flex-col items-center gap-3">
                  <span className="inline-block w-6 h-6 border-2 border-accent border-t-transparent rounded-full animate-spin" />
                  <span>Querying GDELT, AlienVault OTX, Pulsedive, AbuseIPDB, Nominatim…</span>
                </div>
              ) : (
                <div className="text-center px-8 max-w-md">
                  <div className="text-4xl mb-4 text-accent/40">&#x25C6;</div>
                  <p className="mb-2">Enter a seed query above to begin investigation.</p>
                  <p className="text-dark-500 text-xs">
                    Sources: GDELT (news events), AlienVault OTX (threat pulses), Pulsedive (indicators),
                    AbuseIPDB (IP reports), Nominatim (geocoding).
                  </p>
                </div>
              )}
            </div>
          )}
        </div>

        {/* Histograms panel */}
        <aside className="w-[360px] flex-shrink-0 border-l border-dark-600 bg-dark-900/40 overflow-auto p-3">
          <div className="text-xs font-bold text-accent mb-2">Analytics</div>
          {data ? (
            <HistogramsPanel
              nodes={graphData.nodes}
              edges={graphData.edges}
              activeType={activeType}
              activeTier={activeTier}
              onTypeFilter={setActiveType}
              onTierFilter={setActiveTier}
            />
          ) : (
            <div className="text-dark-500 text-sm">Run an investigation to enable analytics.</div>
          )}
        </aside>

        {/* Dossier panel */}
        <aside className="w-[420px] flex-shrink-0 border-l border-dark-600 bg-dark-900/40 overflow-auto p-3">
          <DossierPanel node={selectedNode} nodes={graphData.nodes} edges={graphData.edges} />
        </aside>
      </div>
    </div>
  );
};

export default App;


