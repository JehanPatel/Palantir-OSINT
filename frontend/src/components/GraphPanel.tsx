import { useEffect, useRef, useState } from "react";
import cytoscape from "cytoscape";
import type { GraphNode, GraphEdge } from "../types";

const NODE_COLORS: Record<string, string> = {
  Event: "#ffd740",
  ThreatActor: "#ff5252",
  Indicator: "#4fc3f7",
  Vulnerability: "#ff7043",
  Location: "#00e5a0",
  Organization: "#b388ff",
};

interface ExtendedNodeData {
  id: string;
  label: string;
  color: string;
  type: string;
  fullLabel: string;
  props: Record<string, unknown>;
}

function nodeColor(type: string): string {
  return NODE_COLORS[type] ?? "#90a4ae";
}

interface GraphPanelProps {
  nodes: GraphNode[];
  edges: GraphEdge[];
  onSelectNode?: (node: GraphNode) => void;
  onSearchAround?: (nodeId: string) => void;
}


const tooltipStyle: React.CSSProperties = {
  position: "fixed",
  zIndex: 9999,
  background: "#1a1a25",
  border: "1px solid #00e5a0",
  borderRadius: 6,
  padding: "10px 14px",
  fontSize: 12,
  lineHeight: "1.5",
  maxWidth: 380,
  maxHeight: 300,
  overflowY: "auto",
  pointerEvents: "none",
  boxShadow: "0 4px 20px rgba(0,0,0,0.6)",
  color: "#e0e0e0",
  fontFamily: "JetBrains Mono, monospace",
};

export default function GraphPanel({ nodes, edges, onSelectNode, onSearchAround }: GraphPanelProps) {

  const containerRef = useRef<HTMLDivElement>(null);
  const cyRef = useRef<cytoscape.Core | null>(null);
  const [tooltip, setTooltip] = useState<{
    visible: boolean;
    x: number;
    y: number;
    content: string;
  }>({ visible: false, x: 0, y: 0, content: "" });

  useEffect(() => {
    if (!containerRef.current) return;
    if (cyRef.current) cyRef.current.destroy();

    const cy = cytoscape({
      container: containerRef.current,
      style: [
        {
          selector: "node",
          style: {
            label: "data(label)",
            "text-valign": "center",
            "text-halign": "center",
            "text-wrap": "ellipsis",
            "text-max-width": "120px",
            color: "#e0e0e0",
            "font-size": "9px",
            "font-family": "JetBrains Mono, monospace",
            "background-color": "data(color)",
            "border-color": "#ffffff30",
            "border-width": 1,
            width: 40,
            height: 40,
            "min-zoomed-font-size": 8,
          },
        },
        {
          selector: "edge",
          style: {
            width: 1.5,
            "line-color": "#555",
            "target-arrow-color": "#888",
            "target-arrow-shape": "triangle",
            "arrow-scale": 0.8,
            "curve-style": "bezier",
            label: "data(label)",
            "font-size": "7px",
            color: "#777",
            "font-family": "JetBrains Mono, monospace",
            "text-rotation": "autorotate",
          },
        },
        {
          selector: "node:selected",
          style: { "border-color": "#00e5a0", "border-width": 3 },
        },
        {
          selector: "edge:selected",
          style: { "line-color": "#00e5a0", "target-arrow-color": "#00e5a0" },
        },
        {
          selector: ".highlighted",
          style: { "border-color": "#00e5a0", "border-width": 3 },
        },
      ],
      layout: { name: "preset" },
      wheelSensitivity: 0.4,
      minZoom: 0.2,
      maxZoom: 5,
    });

    // Store full label + props in node data for tooltip lookups
    const nodeLookup = new Map<string, GraphNode>();
    nodes.forEach((n) => nodeLookup.set(n.id, n));

    const cyNodes = nodes.map((n) => {
      const truncated =
        n.label.length > 30 ? n.label.slice(0, 28) + "\u2026" : n.label;
      return {
        group: "nodes" as const,
        data: {
          id: n.id,
          label: truncated,
          color: nodeColor(n.type),
          type: n.type,
          fullLabel: n.label,
          props: n.properties,
        },
      };
    });

    const cyEdges = edges.map((e) => ({
      group: "edges" as const,
      data: { id: e.id, source: e.source, target: e.target, label: e.label },
    }));

    cy.add([...cyNodes, ...cyEdges]);

    cy.layout({
      name: "breadthfirst",
      animate: true,
      animationDuration: 400,
      directed: true,
      spacingFactor: 1.5,
    }).run();

    // ── Click to select node (and highlight neighborhood) ──────────
    cy.on("tap", "node", (evt: cytoscape.EventObject) => {
      const node = evt.target as cytoscape.NodeSingular;
      const nodeId = node.data("id") as string;
      const orig = nodeLookup.get(nodeId);

      if (orig) {
        onSelectNode?.(orig);
      }

      // Clear previous selection highlights first
      cy.elements().removeClass("highlighted");
      node.connectedEdges().addClass("highlighted");
      node.neighborhood().nodes().addClass("highlighted");
      node.addClass("highlighted");
    });

    // ── Right-click menu: Search Around ─────────────────────────────
    cy.on("cxttap", "node", (evt: cytoscape.EventObject) => {
      const node = evt.target as cytoscape.NodeSingular;
      const nodeId = node.data("id") as string;
      if (nodeId) onSearchAround?.(nodeId);
    });


    // ── Hover tooltip ──────────────────────────────────────────────
    cy.on("mouseover", "node", (evt: cytoscape.EventObject) => {
      const n = evt.target as cytoscape.NodeSingular;
      const raw = n.data() as unknown as ExtendedNodeData;
      const origNode = nodeLookup.get(raw.id);

      if (!origNode) return;

      let content = `<b>${origNode.label}</b>  <span style="color:${nodeColor(
        origNode.type
      )}">[${origNode.type}]</span>`;

      // Add properties (skip empty/source/internal)
      const props = origNode.properties;
      if (props && Object.keys(props).length > 0) {
        content += "<hr style='border-color:#333;margin:4px 0'/>";
        let count = 0;
        for (const [key, val] of Object.entries(props)) {
          if (count >= 12) break; // limit display
          if (!val || key === "source") continue;
          const display = Array.isArray(val)
            ? (val as unknown[]).slice(0, 4).join(", ")
            : String(val).slice(0, 200);
          content += `<div><span style="color:#888">${key}:</span> ${display}</div>`;
          count++;
        }
      }

      // Also show lat/lon if present
      if (origNode.latitude != null && origNode.longitude != null) {
        content += `<div><span style="color:#888">lat/lon:</span> ${origNode.latitude.toFixed(
          2
        )}, ${origNode.longitude.toFixed(2)}</div>`;
      }

      const renderedPosition = n.renderedPosition();
      setTooltip({
        visible: true,
        x: renderedPosition.x + 20,
        y: renderedPosition.y - 10,
        content,
      });
    });

    cy.on("mouseout", "node", () => {
      setTooltip((prev) => ({ ...prev, visible: false }));
    });

    // Also show tooltip on edges
    cy.on("mouseover", "edge", (evt: cytoscape.EventObject) => {
      const edge = evt.target as cytoscape.EdgeSingular;
      const label = edge.data("label") as string;
      const src = edge.source().data("label") as string;
      const tgt = edge.target().data("label") as string;
      const content = `<b>${label}</b><br/><span style="color:#888">from:</span> ${src}<br/><span style="color:#888">to:</span> ${tgt}`;
      const mid = edge.midpoint();
      setTooltip({
        visible: true,
        x: mid.x + 15,
        y: mid.y - 10,
        content,
      });
    });

    cy.on("mouseout", "edge", () => {
      setTooltip((prev) => ({ ...prev, visible: false }));
    });

    cyRef.current = cy;

    return () => {
      cy.destroy();
    };
  }, [nodes, edges]);

  if (nodes.length === 0) {
    return (
      <div className="flex-1 flex items-center justify-center text-dark-500 text-sm">
        No entities to display. Submit a query to begin.
      </div>
    );
  }

  return (
    <div className="flex-1 relative">
      <div className="absolute top-0 left-0 right-0 z-10 px-3 py-2 bg-dark-900/80 backdrop-blur-sm border-b border-dark-600 text-xs text-accent">
        <span className="font-bold">ENTITY GRAPH</span>
        <span className="text-dark-500 ml-2">
          {nodes.length} nodes &middot; {edges.length} edges
        </span>
        <span className="text-dark-500 ml-2">
          &middot; hover any node for details
        </span>
      </div>

      <div className="absolute bottom-2 left-2 z-10 flex flex-wrap gap-2 p-2 rounded bg-dark-800/80 backdrop-blur-sm border border-dark-600 text-[10px]">
        {Object.entries(NODE_COLORS).map(([type, color]) => (
          <span key={type} className="flex items-center gap-1">
            <span
              className="w-2 h-2 rounded-full inline-block"
              style={{ background: color }}
            />
            {type}
          </span>
        ))}
      </div>

      <div ref={containerRef} className="h-full w-full" />

      {/* ── Tooltip overlay ──────────────────────────────────────── */}
      {tooltip.visible && (
        <div
          style={{
            ...tooltipStyle,
            left: tooltip.x,
            top: tooltip.y,
          }}
          dangerouslySetInnerHTML={{ __html: tooltip.content }}
        />
      )}
    </div>
  );
}
