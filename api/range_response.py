import os
import re
from typing import Generator
from fastapi import Request, HTTPException, status
from fastapi.responses import StreamingResponse

RANGE_REGEX = re.compile(r"bytes=(\d*)-(\d*)")


def file_chunk_generator(file_path: str, start: int, chunk_size: int, buffer_size: int = 65536) -> Generator[bytes, None, None]:
    with open(file_path, "rb") as f:
        f.seek(start)
        bytes_left = chunk_size
        while bytes_left > 0:
            read_len = min(buffer_size, bytes_left)
            data = f.read(read_len)
            if not data:
                break
            bytes_left -= len(data)
            yield data


def create_range_response(request: Request, file_path: str, media_type: str = "video/mp4") -> StreamingResponse:
    if not os.path.isfile(file_path):
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Video file not found")

    file_size = os.path.getsize(file_path)
    range_header = request.headers.get("range")

    if not range_header:
        # Full content response
        headers = {
            "Content-Length": str(file_size),
            "Accept-Ranges": "bytes",
        }
        return StreamingResponse(
            file_chunk_generator(file_path, 0, file_size),
            status_code=status.HTTP_200_OK,
            headers=headers,
            media_type=media_type,
        )

    match = RANGE_REGEX.match(range_header.strip())
    if not match:
        raise HTTPException(
            status_code=status.HTTP_416_REQUESTED_RANGE_NOT_SATISFIABLE,
            detail="Invalid range header format",
            headers={"Content-Range": f"bytes */{file_size}"},
        )

    start_str, end_str = match.groups()

    if start_str and end_str:
        start = int(start_str)
        end = int(end_str)
    elif start_str:
        start = int(start_str)
        end = file_size - 1
    elif end_str:
        start = max(0, file_size - int(end_str))
        end = file_size - 1
    else:
        start = 0
        end = file_size - 1

    if start >= file_size or end >= file_size or start > end:
        raise HTTPException(
            status_code=status.HTTP_416_REQUESTED_RANGE_NOT_SATISFIABLE,
            detail="Requested range not satisfiable",
            headers={"Content-Range": f"bytes */{file_size}"},
        )

    content_length = (end - start) + 1
    headers = {
        "Content-Range": f"bytes {start}-{end}/{file_size}",
        "Accept-Ranges": "bytes",
        "Content-Length": str(content_length),
    }

    return StreamingResponse(
        file_chunk_generator(file_path, start, content_length),
        status_code=status.HTTP_206_PARTIAL_CONTENT,
        headers=headers,
        media_type=media_type,
    )

