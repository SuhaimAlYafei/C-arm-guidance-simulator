from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from .synthetic_xray import router

app = FastAPI(
    title="C-arm Synthetic X-ray Service",
    version="1.0.0",
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=[
        "https://c-arm-guidance-simulator.vercel.app",
        "https://c-armsim.com",
    ],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(router)


@app.get("/")
def root() -> dict[str, str]:
    return {"service": "synthetic-xray", "status": "ok"}
