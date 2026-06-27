# 🔍 Palantir OSINT

**A stateless, real-time security investigation platform inspired by Palantir Gotham.**  
Processes unstructured data on the fly, links it into an interactive entity-relationship graph, and projects geospatial findings onto a 3D globe — using free, open-source data points and zero database storage.

```

  ╔═══════════════════════════════════════════════════════════╗
  ║                   PALANTIR  O S I N T                     ║
  ╠═══════════════════════════════════════════════════════════╣
  ║  ┌─────────────────────┐  ┌──────────────────────────┐   ║
  ║  │   ENTITY GRAPH      │  │    GEOSPATIAL VIEW       │   ║
  ║  │   ┌─────┐           │  │    🌍 3D interactive      │   ║
  ║  │   │IOC◄─┤Event│     │  │    globe with markers    │   ║
  ║  │   └──┬──┘    │      │  │    and arc trajectories  │   ║
  ║  │      │  ┌────┘      │  │                          │   ║
  ║  │      └──►Actor│      │  │    [  🌐  ⚡  🔴  ]      │   ║
  ║  │   └─────┘   │
  ║  └─────────────────────┘
  ║       (Cytoscape.js)║

  ╚═══════════════════════════════════════════════════════════╝

```

---

## Table of Contents

1. [Features](#features)
2. [Architecture](#architecture)
3. [Tech Stack](#tech-stack)
4. [Project Structure](#project-structure)
5. [Setup Instructions](#setup-instructions)
   - [Backend (Python/FastAPI)](#backend-pythonfastapi)
   - [Frontend (React/Vite)](#frontend-reactvite)
6. [Usage Guide](#usage-guide)
7. [API Reference](#api-reference)
8. [Data Schema](#data-schema)
9. [External APIs Used](#external-apis-used)
10. [Stateless Design Philosophy](#stateless-design-philosophy)
11. [Troubleshooting](#troubleshooting)

---

## Features

### 🔬 Multi-Source OSINT Aggregation
Seeds a single query and fans out **concurrently** to five free public APIs:

| Source | Data Provided | Endpoint |
|--------|--------------|----------|
| **GDELT DOC API v2** | Global news events, themes, organizations, locations | `gdeltproject.org/api/v2/doc/doc` |
| **AlienVault OTX** | Threat pulses, adversary groups, malware families, IOCs | `otx.alienvault.com/api/v1/pulses/subscribed` |
| **Pulsedive** | Indicator threat scores, risk levels, threat feeds | `pulsedive.com/api/indicators.php` |
| **AbuseIPDB** | IP reputation, abuse confidence scores, report history | `api.abuseipdb.com/api/v2/check` |
| **Nominatim (OSM)** | Geocoding — resolves place names to lat/lon coordinates | `nominatim.openstreetmap.org/search` |

### 🧠 Entity-Relationship Graph (Left Panel)
- **Cytoscape.js** interactive directed graph
- Nodes are color-coded by type: `Event` (amber), `ThreatActor` (red), `Indicator` (blue), `Vulnerability` (orange), `Location` (green), `Organization` (purple)
- Edges labelled with relationship types: `ATTACKED`, `CONTROLS`, `LOCATED_IN`, `CORRELATES_WITH`, `MENTIONS`
- Click a node to highlight its entire neighborhood
- Drag, zoom, pan the graph freely

### ↔️ Draggable Split-Screen Layout
- (Frontend) The original demo included a split-screen layout with a draggable divider. 
- Current build focuses on the **Entity Graph** analytics workflow (geospatial view removed).


### ⚡ Completely Stateless Backend
- Zero database (no SQLite, no PostgreSQL, no Redis)
- Every request spawns a fresh async HTTPX client session
- All data is parsed, unified, and returned in a single HTTP response
- Memory is purged immediately after response is sent

---

## Architecture

```
┌───────────┐     POST /api/investigate?query=...      ┌───────────────┐
│  Browser  │ ════════════════════════════════════════ ▶ │  FastAPI      │
│  (Vite)   │                                           │  (uvicorn)    │
│           │ ◀ ═══════════════════════════════════════ │               │
│  React    │     Unified JSON payload                  │  ┌─────────┐  │
│  + TS     │     { nodes, edges, geojson }             │  │ asyncio │  │
│           │                                           │  │ gather()│  │
│  ┌──────┐ │                                           │  └──┬──┬──┘  │
│  │Cyto- │ │                                           │     │  │     │
│  │scape │ │                                           │  ┌──▼──▼──┐  │
│  └──────┘ │                                           │  │ httpx  │  │
│  ┌──────┐ │                                           │  │(async) │  │
│  │Globe │ │                                           │  └──┬──┬──┘  │
│  │ .gl  │ │                                           │     │  │     │
│  └──────┘ │     ┌─────────┐ ┌──────┐ ┌────────┐     │  ┌──▼──▼──┐  │
└───────────┘     │ GDELT   │ │ OTX  │ │Pulsedive│     │  │ 5 APIs  │
                  │ DOC v2  │ │ API  │ │  API    │     │  │ in      │
                  └─────────┘ └──────┘ └────────┘     │  │ parallel│
                  ┌─────────┐ ┌──────────┐             │  └─────────┘  │
                  │ Abuse   │ │Nominatim │             └───────────────┘
                  │ IPDB    │ │(Geocode) │
                  └─────────┘ └──────────┘
```

**Data flow:**

1. User enters a seed query (IP, domain, organisation, country, city, keyword)
2. Frontend sends `POST /api/investigate?query=<query>`
3. Backend fires **4 concurrent** async HTTP requests to GDELT, OTX, Pulsedive, AbuseIPDB (+ geo fallback to Nominatim)
4. Each response is parsed, deduplicated, and normalized into:
   - **`nodes`**: typed entities with properties
   - **`edges`**: relational connections between nodes
   - **`geojson`**: `FeatureCollection` with `Point` geometries
5. Unified JSON is returned; backend discards all references
6. Frontend hydrates:
   - `GraphPanel` → Cytoscape.js draws the entity graph
   - `GlobePanel` → Globe.gl renders points + arcs on the 3D Earth

---

## Tech Stack

### Backend
| Technology | Purpose |
|-----------|---------|
| **Python 3.12+** | Runtime |
| **FastAPI** | REST API framework with OpenAPI docs |
| **uvicorn** | ASGI server (with `httptools`, `websockets`) |
| **httpx** | Async HTTP client for concurrent API calls |
| **Pydantic v2** | Data validation & serialisation |

### Frontend
| Technology | Purpose |
|-----------|---------|
| **React 18** | UI framework |
| **TypeScript** | Type safety |
| **Vite 5** | Build tool and dev server |
| **Tailwind CSS 3** | Utility-first styling |
| **Cytoscape.js** | Interactive entity-relation graph |
| **Globe.gl** | Three.js-powered 3D geospatial globe |
| **Three.js** | 3D rendering engine (bundled via Globe.gl) |

---

## Project Structure

```
palantir-osint/
├── backend/
│   ├── main.py              # FastAPI app, health endpoint, /api/investigate
│   ├── models.py            # Pydantic schemas (GraphNode, GraphEdge, GeoJSON, etc.)
│   ├── fetchers.py          # Async API fetchers + merge orchestrator
│   └── requirements.txt     # Python dependencies
│
├── frontend/
│   ├── index.html           # Entry HTML
│   ├── package.json         # NPM dependencies
│   ├── tsconfig.json        # TypeScript config
│   ├── vite.config.ts       # Vite config (proxy /api → localhost:8000)
│   ├── tailwind.config.js   # Tailwind theme (dark palette, accent colours)
│   ├── postcss.config.js    # PostCSS plugins
│   └── src/
│       ├── main.tsx         # React DOM entry
│       ├── App.tsx          # Root component (graph + analytics + dossier, search bar)

│       ├── index.css        # Tailwind directives, scrollbar, gutter styles
│       ├── types.ts         # Frontend type definitions matching backend schema
│       ├── useInvestigation.ts  # Custom hook: loading/error/data/investigate
│       └── components/
│           ├── GraphPanel.tsx   # Cytoscape.js entity-relation graph
│           └── GlobePanel.tsx   # Globe.gl 3D geospatial view
│
├── README.md                # This file
└── .gitignore
```

---

## Setup Instructions

### Prerequisites

- **Python 3.12+** installed and on `PATH`
- **Node.js 20+** and **npm 10+** installed
- A terminal (cmd, PowerShell with execution policy set, or Git Bash)

### Backend (Python/FastAPI)

```bash
# Navigate to the backend directory
cd palantir-osint/backend

# (Optional) Create and activate a virtual environment
python -m venv venv
# On Windows:
venv\Scripts\activate
# On Mac/Linux:
# source venv/bin/activate

# Install dependencies
pip install -r requirements.txt

# Start the development server
python main.py
# OR
uvicorn main:app --reload --host 0.0.0.0 --port 8000
```

The backend will be available at **`http://localhost:8000`**.  
Auto-generated OpenAPI docs: **`http://localhost:8000/docs`**

### Frontend (React/Vite)

```bash
# Open a second terminal

# Navigate to the frontend directory
cd palantir-osint/frontend

# Install dependencies
npm install

# Start the development server
npm run dev
```

The frontend will be available at **`http://localhost:5173`**.  
The Vite dev server proxies `/api/*` requests to `http://127.0.0.1:8000`, so everything works out of the box.

### Production Build

```bash
cd palantir-osint/frontend
npm run build
# Output in frontend/dist/

# Serve with any static file server, or serve from FastAPI
```

---

## Usage Guide

### 1. Launch both servers

```bash
# Terminal 1 — Backend
cd palantir-osint/backend && uvicorn main:app --reload --port 8000

# Terminal 2 — Frontend
cd palantir-osint/frontend && npm run dev
```

### 2. Open the application

Navigate to **`http://localhost:5173`** in your browser.  
You'll see:

### 3. Enter a seed query

Type any of the following into the search bar and click **INVESTIGATE** (or press Enter):

| Query Type | Example |
|-----------|---------|
| IP address | `185.220.101.0` |
| Domain | `malware-domain.com` |
| Organisation | `APT29` or `Fancy Bear` |
| Country / City | `Ukraine` or `Kyiv` |
| General threat | `ransomware` or `phishing campaign` |
| Event keyword | `cyber attack on power grid` |

### 4. Explore results

**Left panel — Entity Graph:**
- Nodes are colour-coded by type (see legend in bottom-left corner)
- Click any node to highlight its connected edges and neighbours (toggle)
- Drag nodes to rearrange the layout
- Scroll to zoom, drag the background to pan

**Right panel — 3D Globe:**
- Points appear at geocoded locations from GDELT articles + any node with coordinates
- Animated arcs draw hub-and-spoke connections between the first point and all others
- Drag to rotate the Earth, scroll to zoom
- Hover over any point to see its label

### 5. Resize the split

Drag the thin vertical divider bar between the graph and globe panels to adjust the split ratio. Your preference is saved in `localStorage`.

---

## API Reference

### `POST /api/investigate`

**Query parameter:**

| Param | Type | Required | Description |
|-------|------|----------|-------------|
| `query` | `string` | Yes | Seed query — IP, domain, organisation, country, city, or keyword |

**Response `200 OK`:**

```json
{
  "query": "185.220.101.0",
  "nodes": [
    {
      "id": "abuse-185.220.101.0",
      "label": "IP: 185.220.101.0",
      "type": "Indicator",
      "properties": {
        "abuse_score": 85,
        "total_reports": 23,
        "country": "DE",
        "isp": "Hetzner Online GmbH",
        "usage_type": "Data Center/Web Hosting"
      },
      "latitude": null,
      "longitude": null
    }
  ],
  "edges": [
    {
      "id": "edge-a1b2c3d4e5f6",
      "source": "abuse-185.220.101.0",
      "target": "abuse-report-abc123",
      "label": "ATTACKED",
      "properties": {}
    }
  ],
  "geojson": {
    "type": "FeatureCollection",
    "features": [
      {
        "type": "Feature",
        "geometry": { "type": "Point", "coordinates": [30.5, 50.4] },
        "properties": {
          "id": "loc-Kyiv",
          "label": "Kyiv, Ukraine",
          "type": "gdelt_location",
          "source": "https://...",
          "title": "Cyber attack on Ukrainian grid"
        }
      }
    ]
  }
}
```

**Response `400`:**

```json
{
  "detail": "query must not be empty"
}
```

**Response `502`:**

```json
{
  "detail": "Exception details if external APIs fail"
}
```

### `GET /api/health`

```json
{
  "status": "ok",
  "service": "palantir-osint"
}
```

---

## Data Schema

### `GraphNode`

| Field | Type | Description |
|-------|------|-------------|
| `id` | `string` | Unique identifier (e.g., `abuse-1.2.3.4`, `gdelt-https://...`) |
| `label` | `string` | Display label (truncated to 60 chars) |
| `type` | `enum` | One of: `Event`, `ThreatActor`, `Indicator`, `Vulnerability`, `Location`, `Organization` |
| `properties` | `object` | Source-specific metadata (scores, tags, URLs, descriptions) |
| `latitude` | `float|null` | Geospatial latitude (if available) |
| `longitude` | `float|null` | Geospatial longitude (if available) |

### `GraphEdge`

| Field | Type | Description |
|-------|------|-------------|
| `id` | `string` | Unique edge identifier |
| `source` | `string` | Source node `id` |
| `target` | `string` | Target node `id` |
| `label` | `enum` | One of: `ATTACKED`, `CONTROLS`, `LOCATED_IN`, `CORRELATES_WITH`, `MENTIONS`, `TARGETS`, `ORIGINATES_FROM`, `EXPLOITS` |
| `properties` | `object` | Edge metadata |

### GeoJSON FeatureCollection

Standard [GeoJSON](https://geojson.org/) `FeatureCollection` with `Point` geometries. Each feature's `properties` contains at minimum:

| Property | Type | Description |
|----------|------|-------------|
| `id` | `string` | Reference to the originating node |
| `label` | `string` | Display label for the point |
| `type` | `string` | Entity type or source identifier (e.g., `gdelt_location`, `Indicator`) |

---

## External APIs Used

All APIs are **free and require no API key** (except where noted — but the app works without keys for most functionality).

### GDELT DOC API v2
- **URL:** `https://api.gdeltproject.org/api/v2/doc/doc`
- **Free tier:** Unlimited, no API key required
- **Rate limit:** None documented; be respectful
- **Data:** News articles, themes, locations, persons, organisations matching the seed query

### AlienVault OTX
- **URL:** `https://otx.alienvault.com/api/v1/pulses/subscribed`
- **Free tier:** Public pulses are accessible without API key
- **Data:** Threat pulses, indicators, malware families, adversary tags

### Pulsedive
- **URL:** `https://pulsedive.com/api/indicators.php`
- **Free tier:** 5 requests per day without API key; 100/day with free API key
- **Data:** Indicator risk scores, threat feeds, activity history
- **Note:** For higher rate limits, sign up at pulsedive.com for a free API key and pass it as `?key=YOUR_KEY`

### AbuseIPDB
- **URL:** `https://api.abuseipdb.com/api/v2/check`
- **Free tier:** 1,000 requests per day with free API key
- **Note:** Without a key, this endpoint will 401. The app handles this gracefully — other sources still work.

### OpenStreetMap Nominatim
- **URL:** `https://nominatim.openstreetmap.org/search`
- **Free tier:** Unlimited with a `User-Agent` header
- **Usage policy:** Max 1 request per second. Our code respects this.
- **Data:** Geocoding — resolves city/country/place names to lat/lon coordinates

---

## Stateless Design Philosophy

This platform intentionally stores **zero persistent data**:

1. **No Database** — Every investigation is a fresh computation
2. **No User Sessions** — No login, no auth, no cookies
3. **No Caching** — Every request hits live APIs
4. **No Background Jobs** — No Celery, no message queues
5. **In-Memory Only** — Data lives in Python `list` and `dict` objects during the request, then is garbage-collected

**Why stateless?**
- Zero maintenance overhead (no DB migrations, no backups)
- Trivially horizontally scalable (add more FastAPI workers behind a load balancer)
- Each request is reproducible — no hidden state
- Compliant with ephemeral/edge deployment (Cloudflare Workers, AWS Lambda, etc.)

**Trade-off:** Each request pays the full latency of all external API calls (~2–5 seconds). This is acceptable for an investigative tool where recency matters more than speed.

---

## Troubleshooting

### Backend won't start
```
Error: [Errno 10048] Only one usage of each socket address is normally permitted
```
→ Port 8000 is already in use. Kill the process or change the port:
```bash
# Find the process
netstat -ano | findstr :8000
# Kill it (replace PID)
taskkill /PID <PID> /F
```

### No results returned
- The free APIs may be rate-limiting you. Wait a few seconds and try again.
- Some APIs (Pulsedive, AbuseIPDB) have daily limits without an API key.
- The IP query format must be `x.x.x.x` — AbuseIPDB only triggers on valid IPv4.

### Empty globe / no points
- The query may not have returned any geocodable locations.
- Try a country/city name like "Ukraine" or "Tokyo" to see rich geo results.
- Check the browser console for Globe.gl errors (usually CORS or image-loading related).

### TypeScript errors in editor
```bash
# Ensure dependencies are installed
cd palantir-osint/frontend && npm install
# The errors should disappear after a fresh install + editor reload.
```

### Vite proxy not working
```
Error: Network Error / 405 Method Not Allowed
```
→ Ensure the backend is running on port 8000. The Vite config proxies `/api` to `http://127.0.0.1:8000`.
→ Check that the backend CORS middleware allows your frontend origin.

---

## License

This project is provided as open-source software for educational and research purposes.  
External APIs each have their own terms of service — ensure compliance before production use.

---

*Built with FastAPI, React, Cytoscape.js, Globe.gl, and Tailwind CSS.*
