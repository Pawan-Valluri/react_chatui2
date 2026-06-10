# backend/app/schemas.py

from pydantic import BaseModel
from typing import Optional

class MessageCreate(BaseModel):
    id: Optional[str] = None
    parentId: Optional[str] = None
    assistantMessageId: Optional[str] = None
    content: str  # The raw input text from the composer
    context: Optional[dict] = None

class ThreadCreate(BaseModel):
    title: Optional[str] = "New Chat"
