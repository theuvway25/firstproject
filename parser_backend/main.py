"""
backend/main.py
LedgerAI FastAPI entry point.
Run with:  python -m uvicorn main:app --reload --port 8000
"""
# LedgerAI parser/ML service.
import logging
import os
import sys

# ── Add backend directory to sys.path so services/ is importable from backend/ ──
_backend_root = os.path.dirname(os.path.abspath(__file__))
if _backend_root not in sys.path:
    sys.path.append(_backend_root)


# ── Configure logging BEFORE any imports that create loggers ──
logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s  %(name)-35s  %(levelname)-7s  %(message)s",
    handlers=[logging.StreamHandler(sys.stdout)],
    force=True,
)

logger = logging.getLogger("ledgerai.main")

from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from auth.routes import router as auth_router
from api.document_routes import router as document_router

app = FastAPI(title="LedgerAI API", version="1.0.0")

# ── CORS ─────────────────────────────────────────────────────
# allow_credentials=True requires specific origins (not "*").
# Standard origins including localhost and the current Vercel production URL.
origins = [
    "http://localhost:5173",
    "http://localhost:5174",
    "http://127.0.0.1:5173",
    "http://127.0.0.1:5174",
    "https://ledger-ai-j5ii.vercel.app"
]

# Support for dynamic Vercel previews and other origins via environment variable
extra_origins = os.getenv("ALLOWED_ORIGINS")
if extra_origins:
    origins.extend([o.strip() for o in extra_origins.split(",") if o.strip()])

app.add_middleware(
    CORSMiddleware,
    allow_origins=origins,
    allow_origin_regex=r"https://ledger-ai-.*\.vercel\.app",  # Matches previews
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
    expose_headers=["*"],
)

# ── Routers ───────────────────────────────────────────────────
app.include_router(auth_router, prefix="/auth", tags=["Auth"])
app.include_router(document_router, prefix="/documents", tags=["Documents"])


# ── Global exception handler ─────────────────────────────────
@app.exception_handler(Exception)
async def global_exception_handler(request: Request, exc: Exception):
    origin = request.headers.get("origin", "")

    # Only echo back origins we actually allow — never reflect arbitrary origins.
    allowed = set(origins)
    cors_origin = origin if origin in allowed else ""

    # Also accept Vercel preview URLs that match the regex pattern.
    import re
    if not cors_origin and re.match(r"https://ledger-ai-.*\.vercel\.app", origin):
        cors_origin = origin

    logger.exception(
        "Unhandled exception on %s %s — %s: %s",
        request.method,
        request.url.path,
        type(exc).__name__,
        exc,
    )

    headers = {"Access-Control-Allow-Credentials": "true"}
    if cors_origin:
        headers["Access-Control-Allow-Origin"] = cors_origin

    return JSONResponse(
        status_code=500,
        content={"detail": f"{type(exc).__name__}: {exc}"},
        headers=headers,
    )


# ── Startup config validation ─────────────────────────────────
@app.on_event("startup")
async def validate_config():
    """Warn loudly at startup if Supabase env vars are missing or still placeholders."""
    from config import SUPABASE_URL, SUPABASE_ANON_KEY, SUPABASE_SERVICE_ROLE_KEY
    bad = {"", "your-anon-public-key-here", "your-service-role-secret-key-here"}
    issues = []
    if not SUPABASE_URL or "your-project-ref" in SUPABASE_URL:
        issues.append("SUPABASE_URL")
    if not SUPABASE_ANON_KEY or SUPABASE_ANON_KEY in bad:
        issues.append("SUPABASE_ANON_KEY")
    if not SUPABASE_SERVICE_ROLE_KEY or SUPABASE_SERVICE_ROLE_KEY in bad:
        issues.append("SUPABASE_SERVICE_ROLE_KEY")

    if issues:
        logger.error("=" * 65)
        logger.error("  MISSING / PLACEHOLDER SUPABASE CONFIG DETECTED")
        logger.error("  The following .env values must be set:")
        for v in issues:
            logger.error("%s", v)
        logger.error("  Get values from: Supabase Dashboard → Settings → API")
        logger.error("  Auth and DB calls WILL FAIL until these are filled in.")
        logger.error("=" * 65)
    else:
        logger.info("Supabase config OK — all credentials present.")


@app.get("/health")
def health():
    from config import SUPABASE_URL, SUPABASE_ANON_KEY, SUPABASE_SERVICE_ROLE_KEY
    configured = all([
        SUPABASE_URL and "your-project-ref" not in SUPABASE_URL,
        SUPABASE_ANON_KEY and len(SUPABASE_ANON_KEY) > 20,
        SUPABASE_SERVICE_ROLE_KEY and len(SUPABASE_SERVICE_ROLE_KEY) > 20,
    ])
    return {"status": "ok", "supabase_configured": configured}


@app.get("/ping")
def ping():
    """
    Lightweight keep-alive endpoint.
    Called by:
      1. Frontend useHeartbeat hook — every 5 min while the user is active.
      2. This service's own work-mode keep-alive — every 10 min during
         long-running processing tasks, so Render does not sleep mid-task
         even if the user goes AFK and the frontend stops sending heartbeats.
    """
    return {"pong": True}


@app.get("/")
def root():
    return {"message": "LedgerAI backend running"}