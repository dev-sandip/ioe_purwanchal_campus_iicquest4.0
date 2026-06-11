from contextlib import asynccontextmanager
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from api.routes import health, detect, correct, check, export, fl
from api.dependencies import get_detector, get_corrector


@asynccontextmanager
async def lifespan(app: FastAPI):
    # Pre-load models on startup
    print("Loading models...")
    get_detector()
    get_corrector()
    print("Models ready.")
    yield
    print("Shutting down.")


app = FastAPI(
    title="Nepali Grammar Checker API",
    description="Detection + correction of wrong Nepali words using FL-trained models.",
    version="1.0.0",
    lifespan=lifespan,
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],       # tighten for production
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(health.router,   tags=["Health"])
app.include_router(detect.router,   tags=["Inference"])
app.include_router(correct.router,  tags=["Inference"])
app.include_router(check.router,    tags=["Inference"])
app.include_router(export.router,   tags=["Export"])
app.include_router(fl.router,       tags=["Federated Learning"])
