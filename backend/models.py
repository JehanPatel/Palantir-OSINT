"""Pydantic models for the unified OSINT graph + GeoJSON schema."""

from __future__ import annotations

from enum import Enum
from typing import Any, Generic, TypeVar

from pydantic import BaseModel, Field


class NodeType(str, Enum):
    EVENT = "Event"
    THREAT_ACTOR = "ThreatActor"
    INDICATOR = "Indicator"
    VULNERABILITY = "Vulnerability"
    LOCATION = "Location"
    ORGANIZATION = "Organization"


class EdgeLabel(str, Enum):
    ATTACKED = "ATTACKED"
    CONTROLS = "CONTROLS"
    LOCATED_IN = "LOCATED_IN"
    CORRELATES_WITH = "CORRELATES_WITH"
    MENTIONS = "MENTIONS"
    TARGETS = "TARGETS"
    ORIGINATES_FROM = "ORIGINATES_FROM"
    EXPLOITS = "EXPLOITS"


class GraphNode(BaseModel):
    id: str = Field(..., description="Unique entity identifier")
    label: str = Field(..., description="Display label")
    type: NodeType
    properties: dict[str, Any] = Field(default_factory=dict)
    latitude: float | None = None
    longitude: float | None = None


class GraphEdge(BaseModel):
    id: str = Field(..., description="Unique relationship identifier")
    source: str = Field(..., description="Source node id")
    target: str = Field(..., description="Target node id")
    label: EdgeLabel
    properties: dict[str, Any] = Field(default_factory=dict)


class GeoJSONGeometry(BaseModel):
    type: str = "Point"
    coordinates: list[float]  # [lon, lat]


class GeoJSONFeature(BaseModel):
    type: str = "Feature"
    geometry: GeoJSONGeometry
    properties: dict[str, Any] = Field(default_factory=dict)


class GeoJSONFeatureCollection(BaseModel):
    type: str = "FeatureCollection"
    features: list[GeoJSONFeature]


class InvestigationPayload(BaseModel):
    """The complete unified response sent to the frontend."""

    query: str
    nodes: list[GraphNode]
    edges: list[GraphEdge]
    geojson: GeoJSONFeatureCollection


T = TypeVar("T", bound=BaseModel)


class APIResult(BaseModel, Generic[T]):
    """Wrapper for a single API fetch result."""

    source: str
    success: bool
    data: T | None = None
    error: str | None = None
