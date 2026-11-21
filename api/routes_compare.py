import os
from fastapi import APIRouter, HTTPException, Query
from pydantic import BaseModel, Field

from api.models import PipelineSettings, CompareResponse
from api.compare import execute_ab_comparison

router = APIRouter(prefix="/api/compare", tags=["compare"])


class CompareRequest(BaseModel):
    source: str = "sample1"
    profile_a_settings: PipelineSettings = Field(default_factory=PipelineSettings)
    profile_b_settings: PipelineSettings = Field(default_factory=lambda: PipelineSettings(use_collision_heuristic=False))
    profile_a_name: str = "Profile A: Heuristic Enabled"
    profile_b_name: str = "Profile B: Heuristic Disabled"
    max_frames: int = Field(150, ge=30, le=400)


@router.post("", response_model=CompareResponse)
def run_comparison(req: CompareRequest):
    if req.source == "sample1":
        video_path = "assets/sample_traffic.mp4"
    elif req.source == "sample2":
        video_path = "assets/sample_traffic_2.mp4"
    elif os.path.exists(req.source):
        video_path = req.source
    else:
        raise HTTPException(status_code=400, detail=f"Source video '{req.source}' not found.")

    res = execute_ab_comparison(
        video_path=video_path,
        profile_a_settings=req.profile_a_settings,
        profile_b_settings=req.profile_b_settings,
        profile_a_name=req.profile_a_name,
        profile_b_name=req.profile_b_name,
        max_frames=req.max_frames,
    )
    return res

