"""
啟動腳本：自動從 .env（同目錄）或 apps/web/.env.local 讀取 DATABASE_URL 後啟動 FastAPI
"""
import os
import sys
from pathlib import Path

# 讀取 DATABASE_URL（優先讀同目錄的 .env，再 fallback 到 web/.env.local）
local_env = Path(__file__).parent / '.env'
web_env = Path(__file__).parent.parent / 'web' / '.env.local'
env_file = local_env if local_env.exists() else web_env

if env_file.exists():
    for line in env_file.read_text(encoding='utf-8').splitlines():
        line = line.strip()
        if line.startswith('DATABASE_URL=') and 'DATABASE_URL' not in os.environ:
            val = line.split('=', 1)[1].strip().strip('"').strip("'")
            os.environ['DATABASE_URL'] = val
            print(f"[start] DATABASE_URL loaded from {env_file.name}")
            break
else:
    print(f"[start] env file not found at {env_file}, relying on environment variable")

if not os.environ.get('DATABASE_URL'):
    print("[start] ERROR: DATABASE_URL not set. Exiting.")
    sys.exit(1)

import uvicorn
uvicorn.run("main:app", host="0.0.0.0", port=8000, reload=False)
