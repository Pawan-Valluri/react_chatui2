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

# Global Default Template ID for Docx Generation
DEFAULT_TEMPLATE_ID = root_config.get("DEFAULT_TEMPLATE_ID", "default_template_id")
