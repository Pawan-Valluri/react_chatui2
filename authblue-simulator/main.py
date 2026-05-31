import base64
import hmac
import hashlib
import json
import time
from typing import Optional
from fastapi import FastAPI, Request, Form, Response
from fastapi.responses import HTMLResponse, RedirectResponse
import json
import os

app = FastAPI(title="AuthBlue SSO Simulator")

# Helper to load config.json from root directory
def load_combined_config():
    config = {
        "AUTHBLUE_PORT": 5001
    }
    try:
        config_path = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "config.json")
        if os.path.exists(config_path):
            with open(config_path, "r", encoding="utf-8") as f:
                loaded = json.load(f)
                for k, v in loaded.items():
                    config[k] = v
    except Exception as e:
        print("Failed to load root config.json in SSO Simulator:", e)
    return config

root_config = load_combined_config()

# Standard configuration
JWT_SECRET = "authblue_simulator_jwt_secret_key_999!"

# Sample demo users
DEMO_USERS = [
    {
        "adsId": "cfrost",
        "email": "charles.frost@aexp.com",
        "employeeid": "8881234",
        "firstname": "Charles",
        "lastname": "Frost",
        "fullname": "Charles Frost",
        "color": "#4A90E2"
    },
    {
        "adsId": "beyond_dev",
        "email": "beyond.developer@aexp.com",
        "employeeid": "9994321",
        "firstname": "Beyond",
        "lastname": "Developer",
        "fullname": "Beyond Developer",
        "color": "#016fd0"
    },
    {
        "adsId": "aamex",
        "email": "alice.amex@aexp.com",
        "employeeid": "1112222",
        "firstname": "Alice",
        "lastname": "Amex",
        "fullname": "Alice Amex",
        "color": "#C5A059"
    }
]

def base64url_encode(input_bytes: bytes) -> str:
    return base64.urlsafe_b64encode(input_bytes).decode('utf-8').replace('=', '')

def create_jwt(payload: dict, secret: str) -> str:
    """Generates a standard HS256 JWT using pure Python built-ins."""
    header = {"alg": "HS256", "typ": "JWT"}
    header_json = json.dumps(header, separators=(',', ':')).encode('utf-8')
    payload_json = json.dumps(payload, separators=(',', ':')).encode('utf-8')
    
    header_b64 = base64url_encode(header_json)
    payload_b64 = base64url_encode(payload_json)
    
    signing_input = f"{header_b64}.{payload_b64}".encode('utf-8')
    signature = hmac.new(secret.encode('utf-8'), signing_input, hashlib.sha256).digest()
    signature_b64 = base64url_encode(signature)
    
    return f"{header_b64}.{payload_b64}.{signature_b64}"

@app.get("/login", response_class=HTMLResponse)
def get_login_page(request: Request, redirect: Optional[str] = "http://localhost:5173/"):
    # Generate cards for demo users
    user_cards_html = ""
    for u in DEMO_USERS:
        user_cards_html += f"""
        <div class="user-card" onclick='selectDemoUser({json.dumps(u)})'>
            <div class="avatar" style="background-color: {u['color']};">
                {u['firstname'][0]}{u['lastname'][0]}
            </div>
            <div class="user-info">
                <div class="user-fullname">{u['fullname']}</div>
                <div class="user-meta">adsId: <strong>{u['adsId']}</strong> | email: {u['email']}</div>
            </div>
        </div>
        """

    html_content = f"""
    <!DOCTYPE html>
    <html lang="en">
    <head>
        <meta charset="UTF-8">
        <meta name="viewport" content="width=device-width, initial-scale=1.0">
        <title>AuthBlue SSO Login</title>
        <style>
            :root {{
                --amex-blue: #016fd0;
                --amex-dark-blue: #002663;
                --bg-color: #0b111e;
                --card-bg: rgba(22, 28, 45, 0.7);
                --card-border: rgba(255, 255, 255, 0.08);
                --text-primary: #ffffff;
                --text-secondary: #94a3b8;
                --input-bg: rgba(15, 23, 42, 0.6);
                --input-border: rgba(255, 255, 255, 0.1);
            }}

            * {{
                box-sizing: border-box;
                margin: 0;
                padding: 0;
                font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
            }}

            body {{
                background: radial-gradient(circle at top right, #111d35 0%, var(--bg-color) 70%);
                color: var(--text-primary);
                display: flex;
                align-items: center;
                justify-content: center;
                min-height: 100vh;
                padding: 20px;
                overflow-x: hidden;
            }}

            /* Glow/halo background elements */
            .halo {{
                position: absolute;
                width: 600px;
                height: 600px;
                border-radius: 50%;
                background: radial-gradient(circle, rgba(1, 111, 208, 0.15) 0%, rgba(1, 111, 208, 0) 70%);
                top: -100px;
                left: -100px;
                z-index: 0;
                pointer-events: none;
            }}

            .login-container {{
                background: var(--card-bg);
                backdrop-filter: blur(20px);
                -webkit-backdrop-filter: blur(20px);
                border: 1px solid var(--card-border);
                border-radius: 20px;
                width: 100%;
                max-width: 520px;
                padding: 40px;
                box-shadow: 0 20px 40px rgba(0, 0, 0, 0.4), 0 0 0 1px rgba(255, 255, 255, 0.05);
                position: relative;
                z-index: 1;
            }}

            .logo-section {{
                display: flex;
                flex-direction: column;
                align-items: center;
                margin-bottom: 35px;
                text-align: center;
            }}

            .logo-badge {{
                width: 52px;
                height: 52px;
                background-color: var(--amex-blue);
                border-radius: 12px;
                display: flex;
                align-items: center;
                justify-content: center;
                margin-bottom: 16px;
                box-shadow: 0 0 20px rgba(1, 111, 208, 0.4);
            }}

            .logo-badge svg {{
                width: 28px;
                height: 28px;
                fill: #ffffff;
            }}

            .title {{
                font-size: 1.6rem;
                font-weight: 700;
                letter-spacing: -0.5px;
                background: linear-gradient(135deg, #ffffff 0%, #e2e8f0 100%);
                -webkit-background-clip: text;
                -webkit-text-fill-color: transparent;
                margin-bottom: 6px;
            }}

            .subtitle {{
                font-size: 0.9rem;
                color: var(--text-secondary);
            }}

            .section-label {{
                font-size: 0.75rem;
                text-transform: uppercase;
                letter-spacing: 1px;
                font-weight: 600;
                color: var(--text-secondary);
                margin-bottom: 12px;
                display: block;
            }}

            .demo-users-section {{
                margin-bottom: 25px;
            }}

            .user-card {{
                display: flex;
                align-items: center;
                background: var(--input-bg);
                border: 1px solid var(--input-border);
                border-radius: 12px;
                padding: 14px 18px;
                margin-bottom: 10px;
                cursor: pointer;
                transition: all 0.25s cubic-bezier(0.4, 0, 0.2, 1);
            }}

            .user-card:hover {{
                border-color: var(--amex-blue);
                transform: translateY(-2px);
                background: rgba(1, 111, 208, 0.08);
                box-shadow: 0 8px 16px rgba(0, 0, 0, 0.2);
            }}

            .avatar {{
                width: 40px;
                height: 40px;
                border-radius: 10px;
                display: flex;
                align-items: center;
                justify-content: center;
                font-weight: 700;
                font-size: 0.95rem;
                color: #ffffff;
                margin-right: 15px;
                box-shadow: inset 0 2px 4px rgba(255, 255, 255, 0.2);
            }}

            .user-info {{
                flex: 1;
            }}

            .user-fullname {{
                font-size: 0.95rem;
                font-weight: 600;
                margin-bottom: 2px;
            }}

            .user-meta {{
                font-size: 0.75rem;
                color: var(--text-secondary);
            }}

            .divider {{
                display: flex;
                align-items: center;
                text-align: center;
                color: var(--text-secondary);
                font-size: 0.75rem;
                margin: 25px 0;
            }}

            .divider::before, .divider::after {{
                content: '';
                flex: 1;
                border-bottom: 1px solid rgba(255, 255, 255, 0.08);
            }}

            .divider:not(:empty)::before {{
                margin-right: 15px;
            }}

            .divider:not(:empty)::after {{
                margin-left: 15px;
            }}

            form {{
                display: flex;
                flex-direction: column;
            }}

            .form-group {{
                margin-bottom: 16px;
                display: flex;
                flex-direction: column;
            }}

            label {{
                font-size: 0.8rem;
                font-weight: 500;
                color: var(--text-secondary);
                margin-bottom: 6px;
            }}

            input {{
                background: var(--input-bg);
                border: 1px solid var(--input-border);
                border-radius: 10px;
                padding: 12px 16px;
                color: var(--text-primary);
                font-size: 0.9rem;
                transition: all 0.2s ease;
                outline: none;
            }}

            input:focus {{
                border-color: var(--amex-blue);
                box-shadow: 0 0 0 3px rgba(1, 111, 208, 0.15);
            }}

            .row {{
                display: grid;
                grid-template-columns: 1fr 1fr;
                gap: 15px;
            }}

            .submit-btn {{
                background-color: var(--amex-blue);
                color: #ffffff;
                border: none;
                border-radius: 10px;
                padding: 14px;
                font-size: 0.95rem;
                font-weight: 600;
                cursor: pointer;
                transition: all 0.2s ease;
                margin-top: 10px;
                box-shadow: 0 4px 12px rgba(1, 111, 208, 0.25);
            }}

            .submit-btn:hover {{
                background-color: #0059b0;
                transform: translateY(-1px);
                box-shadow: 0 6px 16px rgba(1, 111, 208, 0.35);
            }}

            .submit-btn:active {{
                transform: translateY(0);
            }}

            .footer-info {{
                margin-top: 30px;
                text-align: center;
                font-size: 0.75rem;
                color: var(--text-secondary);
            }}

            .footer-info a {{
                color: var(--amex-blue);
                text-decoration: none;
            }}
        </style>
    </head>
    <body>
        <div class="halo"></div>
        <div class="login-container">
            <div class="logo-section">
                <div class="logo-badge">
                    <svg viewBox="0 0 24 24">
                        <path d="M19 10.5V20H5V4h9.5L19 8.5v2zM13 3H5a2 2 0 00-2 2v14a2 2 0 002 2h14a2 2 0 002-2v-9h-5.5A2.5 2.5 0 0113 9.5V3z"/>
                        <path d="M12.5 12h-3v3.5h3c.8 0 1.5-.4 1.5-1.2v-1.1c0-.8-.7-1.2-1.5-1.2zm6-4L14 3.5V8h4.5z" opacity="0.3"/>
                        <path d="M11 12H8.5v5.5H11c.8 0 1.5-.6 1.5-1.4v-2.7c0-.8-.7-1.4-1.5-1.4z" />
                        <path d="M14.5 12v5.5h1.2v-2.2h2v-1.1h-2V13h2.3v-1h-3.5z" />
                    </svg>
                </div>
                <div class="title">AuthBlue SSO</div>
                <div class="subtitle">American Express Identity Management Simulator</div>
            </div>

            <div class="demo-users-section">
                <span class="section-label">Quick Sign-in with Demo User</span>
                {user_cards_html}
            </div>

            <div class="divider">OR USE CUSTOM PROFILE</div>

            <form action="/login" method="POST">
                <input type="hidden" name="redirect" value="{redirect}">
                <div class="form-group">
                    <label for="adsId">Active Directory ID (adsId)</label>
                    <input type="text" id="adsId" name="adsId" placeholder="e.g. cfrost" required>
                </div>
                <div class="form-group">
                    <label for="email">Corporate Email</label>
                    <input type="email" id="email" name="email" placeholder="e.g. charles.frost@aexp.com" required>
                </div>
                <div class="row">
                    <div class="form-group">
                        <label for="firstname">First Name</label>
                        <input type="text" id="firstname" name="firstname" placeholder="Charles" required>
                    </div>
                    <div class="form-group">
                        <label for="lastname">Last Name</label>
                        <input type="text" id="lastname" name="lastname" placeholder="Frost" required>
                    </div>
                </div>
                <div class="form-group">
                    <label for="employeeid">Employee ID</label>
                    <input type="text" id="employeeid" name="employeeid" placeholder="8881234" required>
                </div>
                <button type="submit" class="submit-btn">Sign in with AuthBlue</button>
            </form>

            <div class="footer-info">
                Simulating shielded infrastructure according to <a href="#">ab_sso.md</a> guidelines.
            </div>
        </div>

        <script>
            function selectDemoUser(user) {{
                document.getElementById('adsId').value = user.adsId;
                document.getElementById('email').value = user.email;
                document.getElementById('firstname').value = user.firstname;
                document.getElementById('lastname').value = user.lastname;
                document.getElementById('employeeid').value = user.employeeid;
                
                // Submit automatically
                setTimeout(() => {{
                    document.querySelector('form').submit();
                }}, 200);
            }}
        </script>
    </body>
    </html>
    """
    return html_content

@app.post("/login")
def post_login(
    response: Response,
    redirect: str = Form("http://localhost:5173/"),
    adsId: str = Form(...),
    email: str = Form(...),
    firstname: str = Form(...),
    lastname: str = Form(...),
    employeeid: str = Form(...)
):
    # Construct claims matching ab_sso.md specifications
    now = int(time.time())
    payload = {
        "GUID": hashlib.md5(adsId.encode('utf-8')).hexdigest(),
        "employeeid": employeeid,
        "firstname": firstname,
        "lastname": lastname,
        "fullname": f"{firstname} {lastname}",
        "email": email,
        "adsId": adsId,
        "uid": adsId,
        "sub": adsId,
        "udn": f"CN={firstname} {lastname},OU=FIMPortal,OU=AMEX,DC=ADS-SSO-1,DC=AEXP,DC=COM",
        "iss": "https://aexp.com",
        "aud": "*-dev.aexp.com",
        "exp": now + 604800,  # 7 days expiry
        "iat": now,
        "jti": f"sim-{hashlib.sha1(adsId.encode('utf-8')).hexdigest()[:16]}"
    }
    
    # Create the cryptographically valid JWT
    jwt_token = create_jwt(payload, JWT_SECRET)
    
    # Set cookie (domain=None means it will default to localhost host, path="/" makes it visible on all paths)
    # Browsers will allow other ports on localhost to read localhost cookies.
    response = RedirectResponse(url=redirect, status_code=303)
    response.set_cookie(
        key="bluetoken",
        value=jwt_token,
        httponly=True,
        path="/",
        samesite="lax",
        max_age=604800  # 7 days
    )
    return response

@app.get("/logout")
def logout(response: Response, redirect: Optional[str] = "http://localhost:5173/"):
    response = RedirectResponse(url=redirect, status_code=303)
    # Delete cooke by setting expiry in past
    response.delete_cookie(key="bluetoken", path="/")
    return response

if __name__ == "__main__":
    import uvicorn
    port = int(os.environ.get("PORT", root_config["AUTHBLUE_PORT"]))
    print(f"Starting AuthBlue SSO Simulator on port {port}...")
    uvicorn.run("main:app", host="127.0.0.1", port=port, reload=True)
