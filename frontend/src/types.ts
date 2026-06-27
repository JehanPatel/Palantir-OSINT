/** Mirrors the backend's Pydantic schema for the unified response. */

export interface GraphNode {
  id: string;
  label: string;
  type: "Event" | "ThreatActor" | "Indicator" | "Vulnerability" | "Location" | "Organization";
  properties: Record<string, unknown>;
  latitude: number | null;
  longitude: number | null;
}

export interface GraphEdge {
  id: string;
  source: string;
  target: string;
  label: "ATTACKED" | "CONTROLS" | "LOCATED_IN" | "CORRELATES_WITH" | "MENTIONS" | "TARGETS" | "ORIGINATES_FROM" | "EXPLOITS";
  properties: Record<string, unknown>;
}

export interface GeoJSONFeature {
  type: "Feature";
  geometry: {
    type: "Point";
    coordinates: [number, number]; // [lon, lat]
  };
  properties: Record<string, unknown>;
}

export interface GeoJSONFeatureCollection {
  type: "FeatureCollection";
  features: GeoJSONFeature[];
}

export interface InvestigationPayload {
  query: string;
  nodes: GraphNode[];
  edges: GraphEdge[];
  geojson: GeoJSONFeatureCollection;
}
