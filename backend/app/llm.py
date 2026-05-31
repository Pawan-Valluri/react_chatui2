# backend/app/llm.py

from typing import Any
from app.config import USE_MOCK_LLM

def get_polymorphic_llm() -> Any:
    """Injects the appropriate LLM client dynamically based on config."""
    if USE_MOCK_LLM:
        try:
            from app.mock_showcase.mock_llm import MockChatModel
            return MockChatModel()
        except ImportError as e:
            print("Warning: MockChatModel file not found. Falling back to ChatOpenAI:", e)
            
    # Production path: OpenAI ChatModel via LangChain
    from langchain_openai import ChatOpenAI
    return ChatOpenAI(
        model="gpt-4o-mini",
        temperature=0.1
    )
