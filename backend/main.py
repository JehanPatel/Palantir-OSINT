"""Palantir OSINT — Stateless security investigation API.

Single POST endpoint receives a seed query, fans out to 5+ free OSINT
APIs concurrently, normalises into a unified graph + GeoJSON payload,
and returns the result with zero persistent storage.
"""

from __future__ import annotations

import logging
import time

from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware

from fetchers import investigate
from models import InvestigationPayload

# ── Logging ─────────────────────────────────────────────────────────────────
logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s  %(levelname)-8s  %(name)s  %(message)s",
)
log = logging.getLogger("palantir")

# ── App ─────────────────────────────────────────────────────────────────────
app = FastAPI(
    title="Palantir OSINT",
    version="1.0.0",
    description=(
        "Stateless security investigation platform. Accept a seed query, "
        "fire concurrent async requests to free OSINT APIs, normalise into "
        "a unified graph + GeoJSON payload, return instantly."
    ),
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


# ── Health check ────────────────────────────────────────────────────────────


@app.get("/api/health")
async def health():
    return {"status": "ok", "service": "palantir-osint"}


# ── Investigation endpoint ──────────────────────────────────────────────────


@app.post("/api/investigate", response_model=InvestigationPayload)
async def investigate_endpoint(query: str):
    """Run a full investigation on the provided seed query.

    The query can be an IP address, domain, organisation name, country,
    city, or any free-text keyword.
    """
    if not query or not query.strip():
        raise HTTPException(status_code=400, detail="query must not be empty")

    start = time.perf_counter()
    log.info("Investigation started | query=%s", query)

    try:
        result = await investigate(query.strip())
    except Exception as exc:
        log.exception("Investigation failed | query=%s", query)
        raise HTTPException(status_code=502, detail=str(exc))

    elapsed = time.perf_counter() - start
    log.info(
        "Investigation complete | query=%s  nodes=%d  edges=%d  geo=%d  elapsed=%.2fs",
        query,
        len(result["nodes"]),
        len(result["edges"]),
        len(result["geojson"]["features"]),
        elapsed,
    )

    return result


# ── Entrypoint ──────────────────────────────────────────────────────────────

if __name__ == "__main__":
    import uvicorn

    uvicorn.run("main:app", host="0.0.0.0", port=8000, reload=True)
