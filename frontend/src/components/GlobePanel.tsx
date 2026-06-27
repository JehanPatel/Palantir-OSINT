import { useEffect, useRef, useState } from "react";
import type { GeoJSONFeatureCollection } from "../types";

interface GlobePanelProps {
  geojson: GeoJSONFeatureCollection | null;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type GlobeInstance = any;

export default function GlobePanel({ geojson }: GlobePanelProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const globeRef = useRef<GlobeInstance>(null);
  const [ready, setReady] = useState(false);

  // ── Mount globe once ─────────────────────────────────────────
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    let destroyed = false;

    import("globe.gl").then((mod) => {
      if (destroyed || !el) return;

      const Globe = mod.default as unknown as (
        config?: Record<string, boolean>
      ) => (el: HTMLElement) => GlobeInstance;

      const globe = Globe({
        waitForGlobeReady: true,
        animateIn: true,
      })(el)
        .globeImageUrl("//unpkg.com/three-globe/example/img/earth-dark.jpg")
        .bumpImageUrl("//unpkg.com/three-globe/example/img/earth-topology.png")
        .backgroundImageUrl("//unpkg.com/three-globe/example/img/night-sky.png")
        .width(el.clientWidth)
        .height(el.clientHeight)
        .pointAltitude("altitude")
        .pointColor("color")
        .pointLabel("label")
        .pointRadius(0.5)
        .pointResolution(16)
        .atmosphereColor("#00e5a0")
        .atmosphereAltitude(0.25);

      globe
        .arcsTransitionDuration(2000)
        .arcColor(() => "#00e5a080")
        .arcAltitudeAuto(true)
        .arcStroke(0.8)
        .arcDashLength(0.15)
        .arcDashGap(0.08)
        .arcDashAnimateTime(3000);

      globeRef.current = globe;
      setReady(true);
    });

    // ── Resize handler using a ref (no stale closure) ───────────
    const handleResize = () => {
      const g = globeRef.current;
      const c = containerRef.current;
      if (g && c) {
        g.width(c.clientWidth);
        g.height(c.clientHeight);
      }
    };
    window.addEventListener("resize", handleResize);

    // Also watch for the splitter via MutationObserver as a backup
    const observer = new ResizeObserver(handleResize);
    if (el.parentElement) observer.observe(el.parentElement);

    return () => {
      destroyed = true;
      window.removeEventListener("resize", handleResize);
      observer.disconnect();
      const g = globeRef.current;
      if (g && g._destructor) g._destructor();
      globeRef.current = null;
    };
  }, []);

  // ── Update data when geojson changes ──────────────────────────
  useEffect(() => {
    const globe = globeRef.current;
    if (!globe || !geojson || !ready) return;

    const points = geojson.features
      .filter(
        (f) =>
          f.geometry?.coordinates?.[0] != null &&
          f.geometry?.coordinates?.[1] != null
      )
      .map((f) => ({
        lat: f.geometry.coordinates[1],
        lng: f.geometry.coordinates[0],
        label: (f.properties?.label as string) ?? "",
        color: colorByType(f.properties?.type as string | undefined),
        altitude: 0.1,
        radius: 0.4,
      }));

    globe.pointsData(points);

    if (points.length >= 2) {
      const hub = points[0];
      const arcs = points.slice(1).map((p) => ({
        startLat: hub.lat,
        startLng: hub.lng,
        endLat: p.lat,
        endLng: p.lng,
      }));
      globe.arcsData(arcs);
    } else {
      globe.arcsData([]);
    }
  }, [geojson, ready]);

  return (
    <div className="flex-1 relative">
      <div className="absolute top-0 left-0 right-0 z-10 px-3 py-2 bg-dark-900/80 backdrop-blur-sm border-b border-dark-600 text-xs text-accent">
        <span className="font-bold">GEOSPATIAL VIEW</span>
        <span className="text-dark-500 ml-2">
          {geojson?.features?.length ?? 0} points
        </span>
      </div>
      <div ref={containerRef} className="h-full w-full" />
    </div>
  );
}

function colorByType(type: string | undefined): string {
  switch (type) {
    case "ThreatActor":
      return "#ff5252";
    case "Indicator":
      return "#4fc3f7";
    case "Event":
    case "gdelt_location":
    case "geocoded_from_gdelt":
      return "#ffd740";
    case "Location":
      return "#00e5a0";
    case "Organization":
      return "#b388ff";
    default:
      return "#90a4ae";
  }
}
