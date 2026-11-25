import os
import json
import logging
from typing import List, Dict, Any, Optional
from fastapi import APIRouter, HTTPException, status
from fastapi.responses import FileResponse, JSONResponse

logger = logging.getLogger("TrafficMonitor.API.Evaluation")

router = APIRouter(prefix="/api/eval", tags=["Evaluation"])

EVAL_RESULTS_DIR = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", "eval", "results"))


@router.get("/latest")
def get_latest_evaluation_report() -> Dict[str, Any]:
    """Returns the latest evaluation run report if available."""
    latest_pointer = os.path.join(EVAL_RESULTS_DIR, "latest.json")
    if not os.path.exists(latest_pointer):
        return {
            "has_run": False,
            "message": "No evaluation run found on system. Place clips into 'eval/clips/' and execute 'python scripts/evaluate.py'.",
        }

    try:
        with open(latest_pointer, "r", encoding="utf-8") as f:
            pointer_data = json.load(f)

        run_id = pointer_data.get("latest_run_id")
        run_dir = pointer_data.get("run_dir") or os.path.join(EVAL_RESULTS_DIR, run_id)
        report_json_path = os.path.join(run_dir, "report.json")

        if not os.path.exists(report_json_path):
            return {
                "has_run": False,
                "message": f"Report for run '{run_id}' missing on disk.",
            }

        with open(report_json_path, "r", encoding="utf-8") as rf:
            report_data = json.load(rf)

        return {
            "has_run": True,
            "report": report_data,
        }
    except Exception as e:
        logger.error(f"Failed to read latest evaluation report: {e}")
        return {
            "has_run": False,
            "message": f"Error loading evaluation report: {str(e)}",
        }


@router.get("/runs")
def list_evaluation_runs() -> List[Dict[str, Any]]:
    """Lists all historical evaluation runs."""
    if not os.path.exists(EVAL_RESULTS_DIR):
        return []

    runs = []
    for entry in sorted(os.listdir(EVAL_RESULTS_DIR), reverse=True):
        entry_dir = os.path.join(EVAL_RESULTS_DIR, entry)
        if not os.path.isdir(entry_dir) or entry == "failures":
            continue

        report_file = os.path.join(entry_dir, "report.json")
        if os.path.exists(report_file):
            try:
                with open(report_file, "r", encoding="utf-8") as f:
                    data = json.load(f)
                runs.append({
                    "run_id": data.get("run_id", entry),
                    "timestamp_utc": data.get("timestamp_utc", ""),
                    "backend": data.get("backend", "pytorch"),
                    "total_clips": data.get("summary_all", {}).get("summary", {}).get("total_clips", 0),
                    "f1_score": data.get("summary_all", {}).get("rates", {}).get("f1_score", 0.0),
                    "is_smoke_test": data.get("is_smoke_test", False),
                })
            except Exception:
                continue

    return runs


@router.get("/runs/{run_id}")
def get_evaluation_run(run_id: str) -> Dict[str, Any]:
    """Retrieves full report for a specific evaluation run."""
    run_dir = os.path.join(EVAL_RESULTS_DIR, run_id)
    report_file = os.path.join(run_dir, "report.json")
    if not os.path.exists(report_file):
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=f"Evaluation run '{run_id}' not found.")

    with open(report_file, "r", encoding="utf-8") as f:
        return json.load(f)


@router.get("/runs/{run_id}/failures/{filename}")
def get_failure_snapshot(run_id: str, filename: str):
    """Serves a failure snapshot image."""
    img_path = os.path.join(EVAL_RESULTS_DIR, run_id, "failures", filename)
    if not os.path.exists(img_path):
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Failure snapshot not found.")
    return FileResponse(img_path, media_type="image/jpeg")
