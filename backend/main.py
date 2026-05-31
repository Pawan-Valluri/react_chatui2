# backend/main.py

import uvicorn
import os
from database import init_db
from app.config import root_config

if __name__ == "__main__":
    # Initialize SQL database tables
    init_db()
    
    # Resolve backend port from configuration file or environment override
    port = int(os.environ.get("PORT", root_config.get("BACKEND_PORT", 8080)))
    print(f"Starting APCOT Chat Backend on port {port}...")
    
    # Run the modularized FastAPI application using reload trigger in development
    uvicorn.run("app.main:app", host="127.0.0.1", port=port, reload=True)
