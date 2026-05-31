# backend/app/config.py

import os
import json

def load_combined_config():
    config = {
        "BACKEND_PORT": 8080,
        "AUTHBLUE_PORT": 5001,
        "FRONTEND_PORT": 5173,
        "ENABLE_SSO": True,
        "ENABLE_STREAMING": True
    }
    try:
        # Resolve config.json in the parent workspace root folder
        config_path = os.path.join(os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__)))), "config.json")
        if os.path.exists(config_path):
            with open(config_path, "r", encoding="utf-8") as f:
                loaded = json.load(f)
                for k, v in loaded.items():
                    config[k] = v
    except Exception as e:
        print("Failed to load root config.json in backend/app/config:", e)
    return config

root_config = load_combined_config()
frontend_port = root_config.get("FRONTEND_PORT", 5173)

# Load configure values for backend delays from nested MOCK_CONFIG with default fallbacks
mock_config = root_config.get("MOCK_CONFIG", {})
REASONING_STEP_DELAY = float(mock_config.get("REASONING_STEP_DELAY", 0.12))
TOOL_RUNNING_DELAY = float(mock_config.get("TOOL_RUNNING_DELAY", 0.4))
TOOL_COMPLETE_DELAY = float(mock_config.get("TOOL_COMPLETE_DELAY", 0.15))
TEXT_STREAM_DELAY = float(mock_config.get("TEXT_STREAM_DELAY", 0.018))

REGULAR_REASONING_DELAY = float(mock_config.get("REGULAR_REASONING_DELAY", 0.06))
REGULAR_TOOL_RUNNING_DELAY = float(mock_config.get("REGULAR_TOOL_RUNNING_DELAY", 0.3))
REGULAR_TOOL_COMPLETE_DELAY = float(mock_config.get("REGULAR_TOOL_COMPLETE_DELAY", 0.1))
REGULAR_TEXT_STREAM_DELAY = float(mock_config.get("REGULAR_TEXT_STREAM_DELAY", 0.015))

# Global SSO authentication settings
env_sso = os.environ.get("ENABLE_SSO")
if env_sso is not None:
    ENABLE_SSO = env_sso.lower() == "true"
else:
    ENABLE_SSO = bool(root_config.get("ENABLE_SSO", True))

# Global streaming settings
ENABLE_STREAMING = bool(root_config.get("ENABLE_STREAMING", True))

# Global Mock LLM toggle
USE_MOCK_LLM = bool(mock_config.get("USE_MOCK_LLM", True))
