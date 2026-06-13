# backend/app/main.py

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from app.config import frontend_port
from app.routers import user, threads

app = FastAPI(title="APCOT Chat Backend")

# Enable CORS for the local Vite dev server and production proxies
app.add_middleware(
    CORSMiddleware,
    allow_origins=[
        "http://localhost:5173", "http://127.0.0.1:5173",
        f"http://localhost:{frontend_port}", f"http://127.0.0.1:{frontend_port}"
    ],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Mount logical sub-routers
app.include_router(user.router)
app.include_router(threads.router)

from core.api_router import router as core_router
app.include_router(core_router)

from app.routers import mock_playground
app.include_router(mock_playground.router)
