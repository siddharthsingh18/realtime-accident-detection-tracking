#!/usr/bin/env python3
"""
One-off utility to re-encode demo videos from mp4v to H.264 (avc1) for browser HTML5 compatibility.
"""

import os
import sys
import shutil
import subprocess

def reencode_file(input_path: str, output_path: str) -> bool:
    ffmpeg_bin = shutil.which("ffmpeg") or "/opt/homebrew/bin/ffmpeg"
    if not os.path.exists(ffmpeg_bin) and not shutil.which("ffmpeg"):
        print(f"ERROR: ffmpeg is not installed or not found on PATH. Cannot re-encode {input_path}.", file=sys.stderr)
        return False

    if not os.path.exists(input_path):
        print(f"WARNING: Source file {input_path} does not exist. Skipping.", file=sys.stderr)
        return False

    cmd = [
        ffmpeg_bin,
        "-y",
        "-i", input_path,
        "-c:v", "libx264",
        "-preset", "fast",
        "-crf", "22",
        "-pix_fmt", "yuv420p",
        "-movflags", "+faststart",
        output_path,
    ]
    print(f"Re-encoding {input_path} -> {output_path}...")
    res = subprocess.run(cmd, stdout=subprocess.PIPE, stderr=subprocess.PIPE)
    if res.returncode != 0:
        print(f"ERROR re-encoding {input_path}: {res.stderr.decode('utf-8')}", file=sys.stderr)
        return False
    print(f"Successfully re-encoded {output_path}")
    return True

def main():
    os.makedirs("outputs/h264", exist_ok=True)
    demos = [
        ("outputs/output_scenario1.mp4", "outputs/h264/scenario1.mp4"),
        ("outputs/output_scenario2.mp4", "outputs/h264/scenario2.mp4"),
    ]
    for inp, outp in demos:
        reencode_file(inp, outp)

if __name__ == "__main__":
    main()

