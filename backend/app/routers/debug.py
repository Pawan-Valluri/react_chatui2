from fastapi import APIRouter, Request
import json
import time
import os
import tempfile

router = APIRouter()

@router.post("/api/debug_schema")
async def debug_schema(request: Request):
    data = await request.json()
    temp_dir = tempfile.gettempdir()
    file_path = os.path.join(temp_dir, f"schema_{int(time.time())}.json")
    with open(file_path, 'w') as f:
        json.dump(data, f, indent=2)
    return {"status": "ok", "path": file_path}

