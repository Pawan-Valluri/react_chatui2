# backend/app/routers/user.py

import hashlib
from fastapi import APIRouter, Depends
from app.auth import get_current_user

router = APIRouter()

@router.get("/v1/user/userinfo")
def get_user_userinfo(current_user: dict = Depends(get_current_user)):
    return {
        "uid": current_user["user_id"],
        "firstname": current_user["firstname"],
        "lastname": current_user["lastname"],
        "fullname": current_user["fullname"],
        "email": current_user["email"],
        "employeeid": current_user["employeeid"],
        "GUID": hashlib.md5(current_user["user_id"].encode('utf-8')).hexdigest(),
        "udn": f"CN={current_user['fullname']},OU=FIMPortal,OU=AMEX,DC=ADS-SSO-1,DC=AEXP,DC=COM",
        "scope": {},
        "message": "success",
        "status": "success"
    }

@router.get("/api/user/me")
def get_api_user_me(current_user: dict = Depends(get_current_user)):
    return get_user_userinfo(current_user)

@router.get("/api/starter-prompts")
def get_starter_prompts(current_user: dict = Depends(get_current_user)):
    """Dedicated API endpoint to retrieve standard conversation starter prompts."""
    return [
        {
            "title": "Help & Guidelines",
            "prompt": "Can you list the guidelines in 'ui-project-bootstrap-guidelines.md'?"
        },
        {
            "title": "Knowledge Base Lookup",
            "prompt": "Search the knowledge base for APCOT Chat information"
        },
        {
            "title": "State Machine Demo",
            "prompt": "Show me a demo of your LangGraph thinking and tool executing cycles!"
        },
        {
            "title": "Aesthetics Showcase",
            "prompt": "Explain how your dark mode glassmorphic UI is styled without Tailwind CSS"
        }
    ]
