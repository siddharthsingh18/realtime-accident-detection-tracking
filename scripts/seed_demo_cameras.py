#!/usr/bin/env python3
"""
DEMO DATA SEED SCRIPT FOR GIS SITUATIONAL RADAR

WARNING: This script creates synthetic demonstration cameras at example coordinates
for testing geospatial situational awareness and map features.
DO NOT use or present this data as real operational CCTV surveillance.

Usage:
  python scripts/seed_demo_cameras.py          # Seeds demo cameras
  python scripts/seed_demo_cameras.py --remove # Removes all demo cameras
"""

import sys
import os

PROJECT_ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
if PROJECT_ROOT not in sys.path:
    sys.path.insert(0, PROJECT_ROOT)

import argparse
from datetime import datetime, timezone
from api import db

DEMO_CAMERAS = [
    {
        "id": "demo_cam_01",
        "name": "[DEMO] CP Radial Arterial 1",
        "source": "sample1",
        "lat": 28.6315,
        "lng": 77.2167,
        "heading": 45.0,
        "notes": "[DEMO DATA - NOT REAL CCTV] North-east arterial junction camera",
    },
    {
        "id": "demo_cam_02",
        "name": "[DEMO] Barakhamba Flyover Merge",
        "source": "sample2",
        "lat": 28.6289,
        "lng": 77.2241,
        "heading": 135.0,
        "notes": "[DEMO DATA - NOT REAL CCTV] Multi-lane flyover approach and merge",
    },
    {
        "id": "demo_cam_03",
        "name": "[DEMO] Janpath Transit Crosswalk",
        "source": "sample1",
        "lat": 28.6220,
        "lng": 77.2185,
        "heading": 210.0,
        "notes": "[DEMO DATA - NOT REAL CCTV] Bus corridor and pedestrian transit point",
    },
    {
        "id": "demo_cam_04",
        "name": "[DEMO] Parliament Street Intersection",
        "source": "sample2",
        "lat": 28.6255,
        "lng": 77.2110,
        "heading": 315.0,
        "notes": "[DEMO DATA - NOT REAL CCTV] High-density signaled intersection",
    },
]

def seed_demo_cameras():
    db.init_db()
    print("=" * 60)
    print("   SEEDING SYNTHETIC GIS DEMO CAMERAS")
    print("   [DEMO DATA - STRICTLY FOR TESTING AND DEVELOPMENT]")
    print("=" * 60)

    for cam in DEMO_CAMERAS:
        db.upsert_camera(
            camera_id=cam["id"],
            name=cam["name"],
            source=cam["source"],
            lat=cam["lat"],
            lng=cam["lng"],
            heading=cam["heading"],
            notes=cam["notes"],
            settings_profile={},
            ignore_region=[],
        )
        print(f" [+] Seeded: {cam['id']} -> {cam['name']} @ ({cam['lat']}, {cam['lng']}), heading={cam['heading']}°")

    print("\nSuccessfully seeded 4 synthetic demo cameras.")
    print("Run `python scripts/seed_demo_cameras.py --remove` at any time to remove them.")


def remove_demo_cameras():
    db.init_db()
    print("=" * 60)
    print("   REMOVING SYNTHETIC GIS DEMO CAMERAS")
    print("=" * 60)

    removed_count = 0
    for cam in DEMO_CAMERAS:
        if db.delete_camera(cam["id"]):
            print(f" [-] Removed: {cam['id']}")
            removed_count += 1
        else:
            print(f" [.] Not found or already removed: {cam['id']}")

    print(f"\nCleanup complete. Removed {removed_count} demo camera(s).")


def main():
    parser = argparse.ArgumentParser(description="Seed or remove synthetic demo cameras for GIS radar testing.")
    parser.add_argument("--remove", action="store_true", help="Remove all demo cameras")
    args = parser.parse_args()

    if args.remove:
        remove_demo_cameras()
    else:
        seed_demo_cameras()


if __name__ == "__main__":
    main()
