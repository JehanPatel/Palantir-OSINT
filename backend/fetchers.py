"""Async fetchers for each free OSINT API.

All requests are stateless — results are returned, parsed, and the
HTTPX client session is closed within the same call.

API keys (Pulsedive, AbuseIPDB) are read from environment variables.
"""

from __future__ import annotations

import asyncio
import logging
import re
import uuid
from typing import Any

import httpx

from models import EdgeLabel, GraphEdge, GraphNode, NodeType

try:
    from dotenv import load_dotenv

    load_dotenv()  # loads backend/.env if present
except Exception:
    # python-dotenv is in requirements.txt; if not available we still run.
    pass

import os

# Environment variables:
#   PULSE_DIVE_API_KEY
#   ABUSEIPDB_API_KEY

log = logging.getLogger("palantir")


# ── Timeouts & retries ──────────────────────────────────────────────────────
_TIMEOUT = httpx.Timeout(15.0, connect=10.0)
_MAX_RETRIES = 2

# ── Helpers ─────────────────────────────────────────────────────────────────


def _safe_id(prefix: str) -> str:
    return f"{prefix}-{uuid.uuid4().hex[:12]}"


def _coerce_latlon(lat: Any, lon: Any) -> tuple[float | None, float | None]:
    try:
        return float(lat), float(lon)
    except (TypeError, ValueError):
        return None, None


async def _fetch_json(
    client: httpx.AsyncClient, url: str, params: dict | None = None
) -> dict | list | None:
    for attempt in range(_MAX_RETRIES):
        try:
            await asyncio.sleep(attempt * 0.8)  # simple backoff
            resp = await client.get(url, params=params, timeout=_TIMEOUT)
            if resp.status_code == 302:
                log.info("Redirect %d for %s — skipping", resp.status_code, url)
                return None
            if resp.status_code == 429:
                log.info("Rate-limited (429) for %s — retrying after delay", url)
                if attempt < _MAX_RETRIES - 1:
                    await asyncio.sleep(2.0 * (attempt + 1))
                    continue
                return None
            resp.raise_for_status()
            return resp.json()
        except (httpx.HTTPStatusError, httpx.RequestError, ValueError) as exc:
            code = ""
            if isinstance(exc, httpx.HTTPStatusError):
                code = str(exc.response.status_code)
                if exc.response.status_code in (404, 410):
                    log.info("Endpoint not found %s — %s", code, url)
                    return None
            log.info(
                "Fetch %s for %s: %s",
                code or type(exc).__name__,
                url,
                exc,
            )
            if attempt == _MAX_RETRIES - 1:
                return None
            await asyncio.sleep(1.0 * (attempt + 1))
    return None


# ── 1. GDELT DOC API v2 — articles + geo extraction ────────────────────────

_KNOWN_COUNTRIES = {
    "AFGHANISTAN", "ALBANIA", "ALGERIA", "ANGOLA", "ARGENTINA", "ARMENIA",
    "AUSTRALIA", "AUSTRIA", "AZERBAIJAN", "BAHRAIN", "BANGLADESH", "BELARUS",
    "BELGIUM", "BENIN", "BOLIVIA", "BOSNIA", "BRAZIL", "BRUNEI", "BULGARIA",
    "BURMA", "BURUNDI", "CAMBODIA", "CAMEROON", "CANADA", "CHAD", "CHILE",
    "CHINA", "COLOMBIA", "CONGO", "COSTA_RICA", "CROATIA", "CUBA", "CYPRUS",
    "CZECHIA", "DENMARK", "DOMINICAN_REPUBLIC", "ECUADOR", "EGYPT", "ERITREA",
    "ESTONIA", "ETHIOPIA", "FINLAND", "FRANCE", "GABON", "GAMBIA", "GEORGIA",
    "GERMANY", "GHANA", "GREECE", "GUATEMALA", "GUINEA", "HAITI", "HONDURAS",
    "HUNGARY", "ICELAND", "INDIA", "INDONESIA", "IRAN", "IRAQ", "IRELAND",
    "ISRAEL", "ITALY", "IVORY_COAST", "JAMAICA", "JAPAN", "JORDAN",
    "KAZAKHSTAN", "KENYA", "KOSOVO", "KUWAIT", "KYRGYZSTAN", "LAOS", "LATVIA",
    "LEBANON", "LIBERIA", "LIBYA", "LITHUANIA", "LUXEMBOURG", "MADAGASCAR",
    "MALAWI", "MALAYSIA", "MALI", "MALTA", "MAURITANIA", "MEXICO", "MOLDOVA",
    "MONGOLIA", "MONTENEGRO", "MOROCCO", "MOZAMBIQUE", "MYANMAR", "NAMIBIA",
    "NEPAL", "NETHERLANDS", "NEW_ZEALAND", "NICARAGUA", "NIGER", "NIGERIA",
    "NORTH_KOREA", "NORWAY", "OMAN", "PAKISTAN", "PANAMA", "PARAGUAY",
    "PERU", "PHILIPPINES", "POLAND", "PORTUGAL", "QATAR", "ROMANIA", "RUSSIA",
    "RWANDA", "SAUDI_ARABIA", "SENEGAL", "SERBIA", "SIERRA_LEONE", "SINGAPORE",
    "SLOVAKIA", "SLOVENIA", "SOMALIA", "SOUTH_AFRICA", "SOUTH_KOREA",
    "SOUTH_SUDAN", "SPAIN", "SRI_LANKA", "SUDAN", "SWEDEN", "SWITZERLAND",
    "SYRIA", "TAIWAN", "TAJIKISTAN", "TANZANIA", "THAILAND", "TUNISIA",
    "TURKEY", "TURKMENISTAN", "UGANDA", "UKRAINE", "UNITED_ARAB_EMIRATES",
    "UNITED_KINGDOM", "UNITED_STATES", "URUGUAY", "UZBEKISTAN", "VENEZUELA",
    "VIETNAM", "YEMEN", "ZAMBIA", "ZIMBABWE",
}

_KNOWN_CITIES = {
    "TEHRAN", "MOSCOW", "BEIJING", "KYIV", "WASHINGTON", "LONDON", "PARIS",
    "BERLIN", "TOKYO", "SEOUL", "NEW_DELHI", "ISLAMABAD", "KABUL", "BAGHDAD",
    "DAMASCUS", "RIYADH", "ANKARA", "TEL_AVIV", "JERUSALEM", "PYONGYANG",
    "HAVANA", "CARACAS", "MOGADISHU", "KHARTOUM", "SANA", "TRIPOLI",
    "ALGIERS", "CAIRO", "NAIROBI", "LAGOS", "KINSHASA", "JOHANNESBURG",
    "MUMBAI", "SHANGHAI", "HONG_KONG", "SINGAPORE", "DUBAI", "DOHA",
    "MINSK", "TBILISI", "YEREVAN", "ASTANA", "TASHKENT", "ASHGABAT",
}

_TOPLACES = {*_KNOWN_COUNTRIES, *_KNOWN_CITIES}


def _extract_geo_labels_from_article(article: dict) -> list[str]:
    """Extract place-name-like tokens from GDELT article metadata."""
    labels: set[str] = set()
    for theme in article.get("themes", []) or []:
        if not isinstance(theme, str):
            continue
        for part in theme.split("_"):
            part = part.strip().upper()
            if part in _TOPLACES:
                labels.add(part.replace("_", " ").title())
    for person in article.get("persons", []) or []:
        if isinstance(person, str) and person.upper() in _TOPLACES:
            labels.add(person.title())
    summary: str = (article.get("summary") or "")[:300]
    for token in re.findall(r"\b[A-Z][a-z]+(?:\s[A-Z][a-z]+){0,2}\b", summary):
        upper = token.upper().replace(" ", "_")
        if upper in _TOPLACES:
            labels.add(token)
    return list(labels)


async def fetch_gdelt(
    client: httpx.AsyncClient, query: str
) -> tuple[list[GraphNode], list[GraphEdge], list[dict]]:
    nodes: list[GraphNode] = []
    edges: list[GraphEdge] = []
    geo_features: list[dict] = []

    url = "https://api.gdeltproject.org/api/v2/doc/doc"
    params = {
        "query": query,
        "mode": "artlist",
        "maxrecords": 10,
        "format": "json",
        "sort": "datedesc",
    }

    data = await _fetch_json(client, url, params)
    if not data or "articles" not in data:
        log.info("GDELT returned no articles for query=%s", query)
        return nodes, edges, geo_features

    articles = data["articles"]
    query_node = GraphNode(
        id=_safe_id("query"),
        label=f"Query: {query}",
        type=NodeType.ORGANIZATION,
        properties={"source": "gdelt", "query": query},
    )
    nodes.append(query_node)

    place_names_to_geocode: set[str] = set()

    for article in articles:
        art_id = f"gdelt-{article.get('url', _safe_id('gdelt'))[:48]}"
        title = article.get("title", "Untitled GDELT Event")
        art_node = GraphNode(
            id=art_id,
            label=title[:80],
            type=NodeType.EVENT,
            properties={
                "source": "gdelt",
                "url": article.get("url"),
                "domain": article.get("domain"),
                "language": article.get("language"),
                "summary": (article.get("summary") or "")[:500],
                "themes": article.get("themes", []),
                "persons": article.get("persons", []),
                "organizations": article.get("organizations", []),
            },
        )
        nodes.append(art_node)
        edges.append(
            GraphEdge(
                id=_safe_id("edge"),
                source=query_node.id,
                target=art_id,
                label=EdgeLabel.MENTIONS,
                properties={"source": "gdelt"},
            )
        )

        locations = article.get("locations", []) or []
        for loc in locations:
            loc_name = loc.get("name", "Unknown")
            lat, lon = _coerce_latlon(loc.get("lat"), loc.get("long"))
            loc_id = f"loc-{loc_name.replace(' ', '_')[:32]}"
            loc_node = GraphNode(
                id=loc_id,
                label=loc_name[:80],
                type=NodeType.LOCATION,
                latitude=lat,
                longitude=lon,
                properties={"source": "gdelt", "country": loc.get("country")},
            )
            if not any(n.id == loc_id for n in nodes):
                nodes.append(loc_node)
            edges.append(
                GraphEdge(
                    id=_safe_id("edge"),
                    source=art_id,
                    target=loc_id,
                    label=EdgeLabel.LOCATED_IN,
                    properties={"source": "gdelt"},
                )
            )
            if lat is not None and lon is not None:
                geo_features.append({
                    "type": "Feature",
                    "geometry": {"type": "Point", "coordinates": [lon, lat]},
                    "properties": {
                        "id": loc_id,
                        "label": loc_name[:80],
                        "type": "gdelt_location",
                        "source": article.get("url", ""),
                        "title": title[:100],
                    },
                })
            else:
                place_names_to_geocode.add(loc_name)

        for label in _extract_geo_labels_from_article(article):
            place_names_to_geocode.add(label)

        for org in article.get("organizations", []) or []:
            org_id = f"org-{org.replace(' ', '_')[:32]}"
            org_node = GraphNode(
                id=org_id,
                label=org[:80],
                type=NodeType.ORGANIZATION,
                properties={"source": "gdelt"},
            )
            if not any(n.id == org_id for n in nodes):
                nodes.append(org_node)
            edges.append(
                GraphEdge(
                    id=_safe_id("edge"),
                    source=art_id,
                    target=org_id,
                    label=EdgeLabel.MENTIONS,
                    properties={"source": "gdelt"},
                )
            )

    for place in place_names_to_geocode:
        if place == "Unknown" or not place.strip():
            continue
        existing_id = f"loc-{place.replace(' ', '_')[:32]}"
        existing = [n for n in nodes if n.id == existing_id]
        if existing and existing[0].latitude is not None:
            continue
        geo_feature = await _geocode_place(client, place)
        if geo_feature:
            coords = geo_feature["geometry"]["coordinates"]
            loc_node = GraphNode(
                id=existing_id,
                label=place[:80],
                type=NodeType.LOCATION,
                latitude=coords[1],
                longitude=coords[0],
                properties={"source": "gdelt_geocoded"},
            )
            if not any(n.id == existing_id for n in nodes):
                nodes.append(loc_node)
            geo_features.append(geo_feature)

    return nodes, edges, geo_features


async def _geocode_place(
    client: httpx.AsyncClient, place_name: str
) -> dict | None:
    params = {"q": place_name, "format": "json", "limit": 1}
    data = await _fetch_json(
        client, "https://nominatim.openstreetmap.org/search", params
    )
    if data and isinstance(data, list) and len(data) > 0:
        lat = float(data[0]["lat"])
        lon = float(data[0]["lon"])
        return {
            "type": "Feature",
            "geometry": {"type": "Point", "coordinates": [lon, lat]},
            "properties": {
                "id": f"loc-{place_name.replace(' ', '_')[:32]}",
                "label": place_name[:80],
                "type": "geocoded_from_gdelt",
                "title": place_name[:100],
            },
        }
    return None


# ── 2. AlienVault OTX ──────────────────────────────────────────────────────


async def fetch_otx(
    client: httpx.AsyncClient, query: str
) -> tuple[list[GraphNode], list[GraphEdge]]:
    """Query AlienVault OTX. The /public pulse search endpoint may 404
    without an API key — we handle that and fall back to indicator
    search or gracefully return empty."""
    nodes: list[GraphNode] = []
    edges: list[GraphEdge] = []

    # Check if query looks like a domain for passive_dns fallback
    is_domain = re.match(
        r"^[a-zA-Z0-9][a-zA-Z0-9.-]+\.[a-zA-Z]{2,}$", query.strip()
    )

    # Try public pulse search first
    data = await _fetch_json(
        client,
        "https://otx.alienvault.com/api/v1/pulses/subscribed",
        {"q": query, "page": 1, "limit": 10},
    )
    if data and "results" in data:
        pass  # got data
    elif is_domain:
        # Fallback to passive_dns for domain-like queries
        dns_data = await _fetch_json(
            client,
            f"https://otx.alienvault.com/api/v1/indicators/domain/{query}/passive_dns",
        )
        if dns_data and isinstance(dns_data, list):
            for entry in dns_data[:10]:
                ind_id = _safe_id("otx-dns")
                hostname = entry.get("hostname", query)
                ind_node = GraphNode(
                    id=ind_id,
                    label=f"OTX DNS: {hostname}"[:80],
                    type=NodeType.INDICATOR,
                    properties={
                        "source": "otx",
                        "hostname": hostname,
                        "record_type": entry.get("record_type"),
                        "address": entry.get("address"),
                    },
                )
                nodes.append(ind_node)
            return nodes, edges
        return nodes, edges
    else:
        return nodes, edges

    query_node = GraphNode(
        id=_safe_id("otx-query"),
        label=f"OTX: {query}",
        type=NodeType.INDICATOR,
        properties={"source": "otx", "query": query},
    )
    nodes.append(query_node)

    for pulse in data["results"]:
        pulse_id = f"otx-{pulse.get('id', _safe_id('otx'))}"
        pulse_node = GraphNode(
            id=pulse_id,
            label=(pulse.get("name") or "OTX Pulse")[:80],
            type=NodeType.THREAT_ACTOR,
            properties={
                "source": "otx",
                "description": (pulse.get("description") or "")[:500],
                "tags": pulse.get("tags", []),
                "malware_families": pulse.get("malware_families", []),
                "attack_ids": pulse.get("attack_ids", []),
                "created": pulse.get("created"),
                "adversary": pulse.get("adversary"),
            },
        )
        nodes.append(pulse_node)
        edges.append(
            GraphEdge(
                id=_safe_id("edge"),
                source=query_node.id,
                target=pulse_id,
                label=EdgeLabel.CORRELATES_WITH,
                properties={"source": "otx"},
            )
        )
        for ind in (pulse.get("indicators") or [])[:5]:
            ind_id = f"ioc-{ind.get('indicator', _safe_id('ioc'))[:48]}"
            ind_node = GraphNode(
                id=ind_id,
                label=(ind.get("indicator") or "Unknown IOC")[:80],
                type=NodeType.INDICATOR,
                properties={
                    "source": "otx",
                    "type": ind.get("type"),
                    "description": (ind.get("description") or "")[:300],
                },
            )
            if not any(n.id == ind_id for n in nodes):
                nodes.append(ind_node)
            edges.append(
                GraphEdge(
                    id=_safe_id("edge"),
                    source=pulse_id,
                    target=ind_id,
                    label=EdgeLabel.CONTROLS,
                    properties={"source": "otx"},
                )
            )

    return nodes, edges


# ── 3. Pulsedive ────────────────────────────────────────────────────────────


async def fetch_pulsedive(
    client: httpx.AsyncClient, query: str
) -> tuple[list[GraphNode], list[GraphEdge]]:
    nodes: list[GraphNode] = []
    edges: list[GraphEdge] = []

    pulsedive_key = (os.getenv("PULSE_DIVE_API_KEY") or "").strip()

    params = {"q": query, "type": "indicator", "limit": 10}
    # Pulsedive: free works for limited requests; key increases limits.
    if pulsedive_key:
        params["key"] = pulsedive_key

    try:
        resp = await client.get(
            "https://pulsedive.com/api/indicators.php",
            params=params,
            timeout=_TIMEOUT,
        )
        if resp.status_code in (302, 401, 403):
            log.info("Pulsedive unauthorized (likely bad/missing API key) — skipping")
            return nodes, edges
        resp.raise_for_status()
        data = resp.json()
    except (httpx.HTTPStatusError, httpx.RequestError, ValueError):
        return nodes, edges


    if not data or "results" not in data:
        return nodes, edges

    query_node = GraphNode(
        id=_safe_id("pd-query"),
        label=f"Pulsedive: {query}",
        type=NodeType.INDICATOR,
        properties={"source": "pulsedive", "query": query},
    )
    nodes.append(query_node)

    for result in data["results"]:
        ind_id = f"pd-{result.get('iid', result.get('indicator', _safe_id('pd')))[:48]}"
        properties: dict[str, Any] = {
            "source": "pulsedive",
            "type": result.get("type"),
            "risk": result.get("risk"),
            "risk_text": result.get("risk_text"),
        }
        iid = result.get("iid")
        if iid:
            detail_data = await _fetch_json(
                client, "https://pulsedive.com/api/info.php", {"iid": iid}
            )
            if detail_data and isinstance(detail_data, dict):
                properties["threats"] = detail_data.get("threats", [])
                properties["feeds"] = detail_data.get("feeds", [])

        ind_node = GraphNode(
            id=ind_id,
            label=(result.get("indicator") or "PD Indicator")[:80],
            type=NodeType.INDICATOR,
            properties=properties,
        )
        nodes.append(ind_node)
        edges.append(
            GraphEdge(
                id=_safe_id("edge"),
                source=query_node.id,
                target=ind_id,
                label=EdgeLabel.CORRELATES_WITH,
                properties={"source": "pulsedive"},
            )
        )

    return nodes, edges


# ── 4. AbuseIPDB ─────────────────────────────────────────────────────────────


async def fetch_abuseipdb(
    client: httpx.AsyncClient, query: str
) -> tuple[list[GraphNode], list[GraphEdge]]:
    nodes: list[GraphNode] = []
    edges: list[GraphEdge] = []

    ip_pattern = re.compile(r"^\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}$")
    if not ip_pattern.match(query.strip()):
        return nodes, edges

    abuse_key = (os.getenv("ABUSEIPDB_API_KEY") or "").strip()

    params = {"ipAddress": query, "maxAgeInDays": 90, "verbose": True}
    # AbuseIPDB requires an API key (Authorization header).
    headers: dict[str, str] = {}
    if abuse_key:
        headers["Key"] = abuse_key

    async def _fetch_abuse():
        for attempt in range(_MAX_RETRIES):
            try:
                await asyncio.sleep(attempt * 0.8)
                resp = await client.get(
                    "https://api.abuseipdb.com/api/v2/check",
                    params=params,
                    headers=headers,
                    timeout=_TIMEOUT,
                )
                if resp.status_code in (401, 403):
                    return None
                if resp.status_code == 429:
                    if attempt < _MAX_RETRIES - 1:
                        await asyncio.sleep(2.0 * (attempt + 1))
                        continue
                    return None
                resp.raise_for_status()
                data = resp.json()
                return data
            except (httpx.HTTPStatusError, httpx.RequestError, ValueError):
                if attempt == _MAX_RETRIES - 1:
                    return None
                await asyncio.sleep(1.0 * (attempt + 1))
        return None

    data = await _fetch_abuse()

    if not data or "data" not in data:
        return nodes, edges

    d = data["data"]
    ip_node = GraphNode(
        id=f"abuse-{query}",
        label=f"IP: {query}",
        type=NodeType.INDICATOR,
        properties={
            "source": "abuseipdb",
            "ip": d.get("ipAddress"),
            "abuse_score": d.get("abuseConfidenceScore"),
            "total_reports": d.get("totalReports"),
            "country": d.get("countryCode"),
            "isp": d.get("isp"),
            "domain": d.get("domain"),
            "usage_type": d.get("usageType"),
            "last_reported": d.get("lastReportedAt"),
        },
    )
    nodes.append(ip_node)

    country = d.get("countryCode")
    if country and isinstance(country, str) and len(country) == 2:
        country_name = {
            "DE": "Germany", "US": "United States", "RU": "Russia",
            "CN": "China", "NL": "Netherlands", "FR": "France",
            "GB": "United Kingdom", "SG": "Singapore", "HK": "Hong Kong",
            "UA": "Ukraine", "IR": "Iran", "KP": "North Korea",
        }.get(country.upper())
        if country_name:
            loc_node = GraphNode(
                id=f"abuse-loc-{country}",
                label=country_name[:80],
                type=NodeType.LOCATION,
                properties={"source": "abuseipdb", "country_code": country},
            )
            nodes.append(loc_node)
            edges.append(
                GraphEdge(
                    id=_safe_id("edge"),
                    source=ip_node.id,
                    target=loc_node.id,
                    label=EdgeLabel.ORIGINATES_FROM,
                    properties={"source": "abuseipdb"},
                )
            )

    for report in (d.get("reports") or [])[:5]:
        report_id = _safe_id("abuse-report")
        report_node = GraphNode(
            id=report_id,
            label=f"Report: {report.get('category', 'abuse')}"[:80],
            type=NodeType.EVENT,
            properties={
                "source": "abuseipdb",
                "category": report.get("category"),
                "reporter": report.get("reporterCountryCode"),
                "date": report.get("reportedAt"),
                "comment": (report.get("comment") or "")[:300],
            },
        )
        nodes.append(report_node)
        edges.append(
            GraphEdge(
                id=_safe_id("edge"),
                source=ip_node.id,
                target=report_id,
                label=EdgeLabel.ATTACKED,
                properties={"source": "abuseipdb"},
            )
        )

    return nodes, edges


# ── 5. GeoJSON augmentation via Nominatim ───────────────────────────────────


async def geocode_locations(
    client: httpx.AsyncClient,
    raw_geo_features: list[dict],
) -> list[dict]:
    updated = list(raw_geo_features)
    for feature in updated:
        geom = feature.get("geometry", {})
        coords = geom.get("coordinates", [None, None])
        if coords[0] is not None and coords[1] is not None:
            continue
        label = (feature.get("properties", {}) or {}).get("label", "")
        if not label or label == "Unknown":
            continue
        params = {"q": label, "format": "json", "limit": 1}
        data = await _fetch_json(
            client, "https://nominatim.openstreetmap.org/search", params
        )
        if data and isinstance(data, list) and len(data) > 0:
            lat = float(data[0]["lat"])
            lon = float(data[0]["lon"])
            feature["geometry"]["coordinates"] = [lon, lat]
    return updated


# ── Master orchestrator ─────────────────────────────────────────────────────


async def investigate(query: str) -> dict:
    all_nodes: dict[str, GraphNode] = {}
    all_edges: list[GraphEdge] = []
    geo_features: list[dict] = []

    async with httpx.AsyncClient(
        headers={
            "User-Agent": "PalantirOSINT/1.0 (investigation-platform)",
            "Accept": "application/json",
        },
        timeout=_TIMEOUT,
    ) as client:
        tasks = [
            fetch_gdelt(client, query),
            fetch_otx(client, query),
            fetch_pulsedive(client, query),
            fetch_abuseipdb(client, query),
        ]
        gdelt_result, otx_result, pd_result, abuse_result = await asyncio.gather(
            *tasks, return_exceptions=True
        )

        gdelt_nodes, gdelt_edges, gdelt_geo = (
            gdelt_result if not isinstance(gdelt_result, Exception) else ([], [], [])
        )
        for n in gdelt_nodes:
            all_nodes[n.id] = n
        all_edges.extend(gdelt_edges)
        geo_features.extend(gdelt_geo)

        for src_result in (otx_result, pd_result, abuse_result):
            if isinstance(src_result, Exception):
                continue
            src_nodes, src_edges = src_result
            for n in src_nodes:
                all_nodes[n.id] = n
            all_edges.extend(src_edges)

        geo_features = await geocode_locations(client, geo_features)

    features_list = list(geo_features)
    for n in all_nodes.values():
        if n.latitude is not None and n.longitude is not None:
            features_list.append({
                "type": "Feature",
                "geometry": {"type": "Point", "coordinates": [n.longitude, n.latitude]},
                "properties": {"id": n.id, "label": n.label, "type": n.type.value},
            })

    return {
        "query": query,
        "nodes": list(all_nodes.values()),
        "edges": all_edges,
        "geojson": {"type": "FeatureCollection", "features": features_list},
    }
