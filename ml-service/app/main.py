from fastapi import FastAPI
from pydantic import BaseModel, Field

app = FastAPI(title="Anu ML Service")


class JobRequest(BaseModel):
    report_id: str
    property_id: str
    lat: float = Field(ge=-90.0, le=90.0)
    lon: float = Field(ge=-180.0, le=180.0)
    queue: str = "default"


@app.get("/health")
def health():
    return {"status": "ok"}


@app.post("/process")
def process(req: JobRequest):
    from app.pipeline.orchestrator import run_pipeline
    return run_pipeline(req.report_id, req.property_id, req.lat, req.lon)
