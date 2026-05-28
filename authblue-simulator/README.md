# AuthBlue SSO Simulator

A lightweight, dedicated local **FastAPI** service running on port `5001` that mimics the behavior of a corporate proxy gateway in an enterprise intranet environment.

---

## 🏗️ Core Features

- **JWT Session Signing**: Generates standard cryptographically signed HS256 JWT tokens using pure-Python built-ins, requiring absolutely zero external dependency libraries.
- **Mock Intranet Identity Card List**: Features a premium login interface presenting pre-configured mock corporate profiles (*Charles Frost*, *Beyond Developer*, *Alice Amex*) with quick-login buttons for rapid testing.
- **Custom Profile Credentials**: Provides a secure manual form input to enter any arbitrary ADs ID, Full Name, Email, and Employee ID for full identity flexibility.
- **Secure Cookie Injection**: Sets the signed token under a secure `bluetoken` cookie in the browser scope.
- **SSO Sign-Out Integration**: Deletes active cookies instantly on demand, redirecting the browser back to the SSO workspace portal cleanly.

---

## 🔑 Signed JWT Claim Claims

The simulated signed token is constructed with the standard claims expected by corporate applications:

```json
{
  "alg": "HS256",
  "typ": "JWT"
}
.
{
  "adsId": "cfrost",
  "email": "charles.frost@aexp.com",
  "fullname": "Charles Frost",
  "firstname": "Charles",
  "lastname": "Frost",
  "employeeid": "8881234",
  "exp": 1780000000
}
```

When the user accesses the chat application, the browser automatically forwards this cookie to the main backend server, which decodes the claims to authenticate user identity and filter database rows.

---

## 🚀 Running the Simulator

```bash
# Inside the authblue-simulator folder
# Start the Uvicorn server on port 5001
python -m uvicorn main:app --port 5001 --reload
```
