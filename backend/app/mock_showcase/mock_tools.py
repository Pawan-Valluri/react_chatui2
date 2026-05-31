# backend/mock_showcase/mock_tools.py

import asyncio
import os
import json
from langchain_core.tools import tool

# Helper to load config.json from root directory
def load_combined_config():
    config = {
        "AGENT_THINKING_DELAY": 0.1,
        "AGENT_TOOL_TRIGGER_DELAY": 0.1,
        "AGENT_TOOL_EXECUTION_DELAY": 0.2
    }
    try:
        config_path = os.path.join(os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__)))), "config.json")
        if os.path.exists(config_path):
            with open(config_path, "r", encoding="utf-8") as f:
                loaded = json.load(f)
                mock_cfg = loaded.get("MOCK_CONFIG", {})
                for k, v in mock_cfg.items():
                    config[k] = v
    except Exception as e:
        print("Failed to load root config.json in mock_tools:", e)
    return config

mock_config = load_combined_config()
AGENT_TOOL_TRIGGER_DELAY = float(mock_config.get("AGENT_TOOL_TRIGGER_DELAY", 0.1))
AGENT_TOOL_EXECUTION_DELAY = float(mock_config.get("AGENT_TOOL_EXECUTION_DELAY", 0.2))

@tool
def think(thought: str) -> str:
    """Use this tool to record consecutive thoughts, plans, or silent reasoning steps.
    This enables breaking down complex prompts before executing tools or responding.
    """
    return "Thought recorded."

@tool
async def search_kb(query: str) -> str:
    """Search the corporate Knowledge Base for APCOT Chat system specifications, vanilla CSS design principles, and guidelines."""
    await asyncio.sleep(AGENT_TOOL_TRIGGER_DELAY)
    await asyncio.sleep(AGENT_TOOL_EXECUTION_DELAY)
    return (
        "Knowledge Base Found: 'APCOT Chat' is a premium web client utilizing "
        "@assistant-ui/react primitives styled completely via Vanilla CSS (Tailwind-free) "
        "complying with modular component-tree encapsulation design principles."
    )

@tool
async def check_entitlements(resource: str) -> str:
    """Check group entitlements and access permissions for the current resource."""
    await asyncio.sleep(AGENT_TOOL_TRIGGER_DELAY)
    await asyncio.sleep(AGENT_TOOL_EXECUTION_DELAY)
    return (
        "AUTHORIZED: User is a member of 'SSO_APP_ADMIN'. "
        "Granted full administration, thread deletion, and query permissions."
    )
