# backend/app/auth.py

import base64
import json
from typing import Optional
from fastapi import Request, Header, Cookie, HTTPException
from app.config import ENABLE_SSO

def get_current_user(
    request: Request,
    adsId: Optional[str] = Header(None, alias="adsId"),
    email: Optional[str] = Header(None, alias="email"),
    bluetoken: Optional[str] = Cookie(None)
):
    # Print debug info to console to diagnose cookie/session forwarding issues
    print("\n--- [SSO SESSION CHECK] ---")
    print(f"  URL: {request.url}")
    print(f"  Headers: {dict(request.headers)}")
    print(f"  Cookies: {dict(request.cookies)}")
    print("-----------------------------\n")

    user_id = None
    user_email = None
    fullname = None
    firstname = None
    lastname = None
    employeeid = None

    # 1. Read case-insensitive request headers first (standard production behavior)
    headers = request.headers
    h_ads = headers.get("adsid") or headers.get("adsId") or headers.get("ADSID") or adsId
    h_email = headers.get("email") or headers.get("EMAIL") or email
    h_first = headers.get("firstname") or headers.get("FIRSTNAME")
    h_last = headers.get("lastname") or headers.get("LASTNAME")
    h_full = headers.get("fullname") or headers.get("FULLNAME")
    h_empid = headers.get("employeeid") or headers.get("EMPLOYEEID")

    if h_ads:
        user_id = h_ads
        user_email = h_email
        fullname = h_full or f"{h_first or ''} {h_last or ''}".strip()
        firstname = h_first
        lastname = h_last
        employeeid = h_empid
    elif h_email:
        user_id = h_email
        user_email = h_email
        fullname = h_full
        firstname = h_first
        lastname = h_last
        employeeid = h_empid

    # 2. Decode the `bluetoken` JWT cookie if headers are absent (local development simulator)
    if not user_id and bluetoken:
        try:
            parts = bluetoken.split(".")
            if len(parts) >= 2:
                payload_b64 = parts[1]
                payload_b64 += "=" * (4 - len(payload_b64) % 4)
                payload_bytes = base64.urlsafe_b64decode(payload_b64.encode('utf-8'))
                payload = json.loads(payload_bytes.decode('utf-8'))
                
                ads_id_val = payload.get("adsId") or payload.get("uid") or payload.get("sub")
                email_val = payload.get("email")
                
                if ads_id_val:
                    user_id = ads_id_val
                    user_email = email_val
                    fullname = payload.get("fullname")
                    firstname = payload.get("firstname")
                    lastname = payload.get("lastname")
                    employeeid = payload.get("employeeid")
                elif email_val:
                    user_id = email_val
                    user_email = email_val
                    fullname = payload.get("fullname")
                    firstname = payload.get("firstname")
                    lastname = payload.get("lastname")
                    employeeid = payload.get("employeeid")
        except Exception as e:
            print("JWT base64 decode error in backend auth:", e)

    # 3. Fallback when auth is completely missing
    if not user_id:
        if not ENABLE_SSO:
            return {
                "user_id": "beyond_dev",
                "email": "beyond.developer@aexp.com",
                "fullname": "Beyond Developer",
                "firstname": "Beyond",
                "lastname": "Developer",
                "employeeid": "9994321"
            }
        raise HTTPException(
            status_code=401,
            detail="Unauthorized: No AuthBlue session or headers found"
        )

    return {
        "user_id": user_id,
        "email": user_email or f"{user_id}@aexp.com",
        "fullname": fullname or user_id.capitalize(),
        "firstname": firstname or user_id.capitalize(),
        "lastname": lastname or "",
        "employeeid": employeeid or "0000000"
    }
