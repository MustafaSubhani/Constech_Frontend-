"""Local accounts: display name and password per work email.

Kept in ~/.constech/accounts.json (or CONSTECH_ACCOUNTS), next to the assistant settings.
Passwords are stored as PBKDF2-SHA256 hashes with a per-account salt. Until an account sets
a password any password signs it in (the preview behaviour), so existing users are not locked
out; once set, it is required.
"""
import hashlib
import hmac
import json
import os
import secrets
import threading
import time
from datetime import datetime
from pathlib import Path

_LOCK = threading.Lock()
_ITERATIONS = 240_000
_MAX_SESSIONS = 50


class AuthError(Exception):
    def __init__(self, code, message):
        super().__init__(message)
        self.code = code
        self.message = message


def _path():
    custom = os.environ.get("CONSTECH_ACCOUNTS")
    return Path(custom) if custom else Path.home() / ".constech" / "accounts.json"


def _read():
    path = _path()
    if not path.is_file():
        return {"accounts": {}, "sessions": {}}
    try:
        data = json.loads(path.read_text(encoding="utf-8"))
    except (json.JSONDecodeError, OSError):
        return {"accounts": {}, "sessions": {}}
    data.setdefault("accounts", {})
    data.setdefault("sessions", {})
    return data


def replace_file(tmp, path, attempts=6):
    """os.replace, retried: on Windows it fails while another handle has the target open."""
    for attempt in range(attempts):
        try:
            os.replace(tmp, path)
            return
        except PermissionError:
            if attempt == attempts - 1:
                raise
            time.sleep(0.05 * (attempt + 1))


def _write(data):
    path = _path()
    path.parent.mkdir(parents=True, exist_ok=True)
    tmp = path.with_suffix(".tmp")
    tmp.write_text(json.dumps(data, indent=2), encoding="utf-8")
    replace_file(tmp, path)
    try:
        os.chmod(path, 0o600)
    except OSError:
        pass


def _hash(password, salt):
    return hashlib.pbkdf2_hmac("sha256", password.encode("utf-8"), bytes.fromhex(salt), _ITERATIONS).hex()


def _now():
    return datetime.now().isoformat(timespec="seconds")


def _public(email, account):
    return {"email": email, "name": account.get("name") or "", "hasPassword": bool(account.get("password")), "updated": account.get("updated")}


def login(email, password, default_name):
    email = (email or "").strip().lower()
    if not email or "@" not in email:
        raise AuthError(400, "Enter your work email.")
    with _LOCK:
        data = _read()
        account = data["accounts"].get(email)
        if account and account.get("password"):
            stored = account["password"]
            if not password or not hmac.compare_digest(_hash(password, stored["salt"]), stored["hash"]):
                raise AuthError(401, "That email and password do not match.")
        if not account:
            account = {"name": default_name, "created": _now(), "updated": _now()}
            data["accounts"][email] = account
        token = secrets.token_hex(24)
        data["sessions"][token] = {"email": email, "at": _now()}
        if len(data["sessions"]) > _MAX_SESSIONS:
            for old in sorted(data["sessions"], key=lambda t: data["sessions"][t].get("at") or "")[: len(data["sessions"]) - _MAX_SESSIONS]:
                data["sessions"].pop(old, None)
        _write(data)
    return token, _public(email, account)


def logout(token):
    if not token:
        return
    with _LOCK:
        data = _read()
        if data["sessions"].pop(token, None):
            _write(data)


def check(token):
    """The email of a valid session, or AuthError 401."""
    with _LOCK:
        return _session(token)[1]


def _session(token):
    data = _read()
    session = data["sessions"].get(token or "")
    if not session:
        raise AuthError(401, "Your session has ended. Sign in again.")
    return data, session["email"]


def profile(token):
    with _LOCK:
        data, email = _session(token)
    return _public(email, data["accounts"].get(email) or {})


def update_profile(token, body):
    name = " ".join(str((body or {}).get("name") or "").split())[:80]
    if not name:
        raise AuthError(400, "Enter a name.")
    with _LOCK:
        data, email = _session(token)
        account = data["accounts"].setdefault(email, {"created": _now()})
        account["name"] = name
        account["updated"] = _now()
        _write(data)
        return _public(email, account)


def change_password(token, body):
    body = body or {}
    new = str(body.get("newPassword") or "")
    if len(new) < 8:
        raise AuthError(400, "Use at least 8 characters for the new password.")
    if new.strip() != new or not new.strip():
        raise AuthError(400, "The password cannot start or end with spaces.")
    with _LOCK:
        data, email = _session(token)
        account = data["accounts"].setdefault(email, {"created": _now()})
        stored = account.get("password")
        if stored:
            current = str(body.get("currentPassword") or "")
            if not hmac.compare_digest(_hash(current, stored["salt"]), stored["hash"]):
                raise AuthError(400, "The current password is not right.")
        salt = secrets.token_hex(16)
        account["password"] = {"salt": salt, "hash": _hash(new, salt), "iterations": _ITERATIONS}
        account["updated"] = _now()
        # Other devices signed in to this account are signed out; this one stays.
        data["sessions"] = {t: s for t, s in data["sessions"].items() if s.get("email") != email or t == token}
        _write(data)
        return _public(email, account)
