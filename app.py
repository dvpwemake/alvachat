#!/usr/bin/env python3
"""Meet50 — local meetup web app.

Request → respond → initiator concurs → channel.
Implements the nine shared product functions from meetup-building-plans.md
with a small local API (not CloudKit / Plan 2).
"""
from __future__ import annotations

import base64
import json
import math
import mimetypes
import os
import re
import secrets
import threading
import time
import uuid
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import parse_qs, urlparse

ROOT = Path(__file__).resolve().parent
DATA = ROOT / "data"
PHOTOS = DATA / "photos"
DB_PATH = DATA / "db.json"
STATIC = ROOT / "static"
PORT = int(os.environ.get("MEET50_PORT", "5055"))

LOCK = threading.RLock()
R_EARTH_MI = 3958.7613
ACTIVITY_TTL_MS = 30 * 60 * 1000
FREE_EXPIRE_MS = 30 * 60 * 1000
MAX_PHOTO_BYTES = 2_500_000
GENDERS = ("woman", "man", "nonbinary")
LOOKING = ("male", "female", "lgbtq")
EDUCATION = ("high_school", "associate", "bachelor", "master", "doctorate", "other")
LOOKING_TO_GENDER = {"male": "man", "female": "woman", "lgbtq": "nonbinary"}
INTENTS = ("offer", "ask")
KINDS = ("drink", "meal")
MARITAL = ("single", "partnered", "married", "divorced", "prefer_not")

DEMO_PEOPLE = (
    {
        "name": "Avery Chen",
        "age": 31,
        "gender": "woman",
        "homeCity": "Fremont",
        "job": "Product designer",
        "maritalStatus": "single",
        "bio": "Walks, bookstores, and one good espresso.",
        "lookingFor": "male",
        "education": "bachelor",
        "color": "#ff5a1f",
        "offset": (0.11, 0.07),
    },
    {
        "name": "Jules Okonkwo",
        "age": 36,
        "gender": "man",
        "homeCity": "Ballard",
        "job": "Civil engineer",
        "maritalStatus": "divorced",
        "bio": "Builds bridges. Cooks too much pasta.",
        "lookingFor": "female",
        "education": "master",
        "color": "#7ec8a3",
        "offset": (-0.16, 0.12),
    },
    {
        "name": "Sam Rivera",
        "age": 28,
        "gender": "nonbinary",
        "homeCity": "Capitol Hill",
        "job": "Sound tech",
        "maritalStatus": "single",
        "bio": "Venues, vinyl, and a 10pm curfew on weekdays.",
        "lookingFor": "lgbtq",
        "education": "associate",
        "color": "#c9a227",
        "offset": (0.04, -0.19),
    },
    {
        "name": "Mina Park",
        "age": 41,
        "gender": "woman",
        "homeCity": "West Seattle",
        "job": "ER nurse",
        "maritalStatus": "single",
        "bio": "Night shifts. Honest mornings.",
        "lookingFor": "male",
        "education": "bachelor",
        "color": "#6ea8ff",
        "offset": (0.22, -0.05),
    },
)


def now_ms() -> int:
    return int(time.time() * 1000)


def haversine_mi(a_lat: float, a_lon: float, b_lat: float, b_lon: float) -> float:
    p1, p2 = math.radians(a_lat), math.radians(b_lat)
    dphi = math.radians(b_lat - a_lat)
    dlmb = math.radians(b_lon - a_lon)
    h = math.sin(dphi / 2) ** 2 + math.cos(p1) * math.cos(p2) * math.sin(dlmb / 2) ** 2
    return 2 * R_EARTH_MI * math.asin(min(1.0, math.sqrt(h)))


def empty_db() -> dict:
    return {
        "users": [],
        "sessions": {},
        "requests": [],
        "responds": [],
        "channels": [],
        "messages": [],
        "demos_placed": False,
    }


def load_db() -> dict:
    if not DB_PATH.exists():
        return empty_db()
    with DB_PATH.open(encoding="utf-8") as f:
        data = json.load(f)
    base = empty_db()
    base.update(data)
    return base


def save_db(db: dict) -> None:
    tmp = DB_PATH.with_suffix(".tmp")
    tmp.write_text(json.dumps(db, indent=2), encoding="utf-8")
    tmp.replace(DB_PATH)


def new_id(prefix: str) -> str:
    return f"{prefix}_{uuid.uuid4().hex[:12]}"


def write_svg_photo(user_id: str, initials: str, color: str) -> str:
    PHOTOS.mkdir(parents=True, exist_ok=True)
    pid = new_id("ph")
    path = PHOTOS / f"{pid}.svg"
    safe = re.sub(r"[^A-Za-z0-9 ]", "", initials)[:3] or "?"
    svg = f"""<svg xmlns="http://www.w3.org/2000/svg" width="640" height="640" viewBox="0 0 640 640">
  <rect width="640" height="640" fill="#16150f"/>
  <circle cx="320" cy="320" r="220" fill="{color}"/>
  <text x="320" y="360" text-anchor="middle" font-family="Georgia, serif" font-size="180" fill="#0e0f0c">{safe}</text>
</svg>
"""
    path.write_text(svg, encoding="utf-8")
    return f"/photos/{pid}.svg"


def initials(name: str) -> str:
    parts = [p for p in name.split() if p]
    if not parts:
        return "?"
    if len(parts) == 1:
        return parts[0][:2].upper()
    return (parts[0][0] + parts[-1][0]).upper()


def default_filter() -> dict:
    return {
        "education": "any",
        "distance": 50,
        "ageMin": 18,
        "ageMax": 99,
        "lookingFor": "any",
    }


def normalize_filter(raw) -> dict:
    base = default_filter()
    if not isinstance(raw, dict):
        return base
    edu = raw.get("education") or "any"
    if edu not in ("any",) + EDUCATION:
        edu = "any"
    look = raw.get("lookingFor") or "any"
    if look not in ("any",) + LOOKING:
        look = "any"
    try:
        dist = max(1, min(50, int(raw.get("distance") if raw.get("distance") is not None else 50)))
    except (TypeError, ValueError):
        dist = 50
    try:
        amin = max(18, min(99, int(raw.get("ageMin") if raw.get("ageMin") is not None else 18)))
    except (TypeError, ValueError):
        amin = 18
    try:
        amax = max(18, min(99, int(raw.get("ageMax") if raw.get("ageMax") is not None else 99)))
    except (TypeError, ValueError):
        amax = 99
    if amin > amax:
        amin, amax = amax, amin
    base.update(
        {
            "education": edu,
            "distance": dist,
            "ageMin": amin,
            "ageMax": amax,
            "lookingFor": look,
        }
    )
    return base


def place_demos_around(db: dict, lat: float, lon: float) -> None:
    t = now_ms()
    existing = [u for u in db["users"] if u.get("demo")]
    if not existing:
        for person in DEMO_PEOPLE:
            uid = new_id("usr")
            photo = write_svg_photo(uid, initials(person["name"]), person["color"])
            dlat, dlon = person["offset"]
            db["users"].append(
                {
                    "id": uid,
                    "demo": True,
                    "plan": "free",
                    "name": person["name"],
                    "age": person["age"],
                    "gender": person["gender"],
                    "homeCity": person["homeCity"],
                    "job": person["job"],
                    "maritalStatus": person["maritalStatus"],
                    "bio": person["bio"],
                    "lookingFor": person["lookingFor"],
                    "education": person["education"],
                    "filter": default_filter(),
                    "lastPhoto": photo,
                    "photos": [photo],
                    "preferences": {"lookingFor": "any"},
                    "lat": lat + dlat,
                    "lon": lon + dlon,
                    "locationUpdatedAt": t,
                    "createdAt": t,
                }
            )
        db["demos_placed"] = True
        return
    for person, u in zip(DEMO_PEOPLE, existing):
        dlat, dlon = person["offset"]
        u["lat"] = lat + dlat
        u["lon"] = lon + dlon
        u["locationUpdatedAt"] = t
        u["lookingFor"] = person["lookingFor"]
        u["education"] = person.get("education") or "bachelor"


def public_user(u: dict, viewer: dict | None = None) -> dict:
    dist = None
    if viewer and viewer.get("lat") is not None and u.get("lat") is not None:
        dist = round(haversine_mi(viewer["lat"], viewer["lon"], u["lat"], u["lon"]), 1)
    active = bool(u.get("lat") is not None and (now_ms() - (u.get("locationUpdatedAt") or 0)) <= ACTIVITY_TTL_MS)
    return {
        "id": u["id"],
        "demo": bool(u.get("demo")),
        "plan": u.get("plan") or "free",
        "name": u.get("name"),
        "age": u.get("age"),
        "gender": u.get("gender"),
        "homeCity": u.get("homeCity"),
        "job": u.get("job"),
        "maritalStatus": u.get("maritalStatus"),
        "bio": u.get("bio"),
        "lookingFor": u.get("lookingFor"),
        "education": u.get("education"),
        "lastPhoto": u.get("lastPhoto"),
        "lat": u.get("lat"),
        "lon": u.get("lon"),
        "active": active,
        "miles": dist,
        "isMe": bool(viewer and u["id"] == viewer["id"]),
    }


def user_by_id(db: dict, uid: str) -> dict | None:
    return next((u for u in db["users"] if u["id"] == uid), None)


def session_user(handler: "Handler") -> dict | None:
    auth = handler.headers.get("Authorization") or ""
    token = auth[7:].strip() if auth.lower().startswith("bearer ") else ""
    if not token:
        token = (handler.qs.get("token") or [""])[0]
    if not token:
        return None
    db = handler.db
    uid = db["sessions"].get(token)
    if not uid:
        return None
    return user_by_id(db, uid)


def expired(ts: int | None) -> bool:
    if ts is None:
        return False
    return now_ms() >= ts


def live_photo_ok(user: dict, photo_id: str) -> bool:
    if not photo_id:
        return False
    live = user.get("livePhotos") or {}
    meta = live.get(photo_id)
    if not meta:
        return False
    age = now_ms() - int(meta.get("capturedAt") or 0)
    return 0 <= age <= 10 * 60 * 1000


def apply_expiry_filters(db: dict) -> None:
    t = now_ms()
    for req in db["requests"]:
        if req.get("status") == "open" and req.get("offerExpiresAt") and t >= req["offerExpiresAt"]:
            req["status"] = "expired"
    for rsp in db["responds"]:
        if rsp.get("status") == "pending" and rsp.get("expiresAt") and t >= rsp["expiresAt"]:
            rsp["status"] = "expired"


def sync_prefs_from_profile(u: dict) -> None:
    """Profile looking-for + saved filter drive the feed selectors."""
    filt = u.get("filter") if isinstance(u.get("filter"), dict) else default_filter()
    looking = u.get("lookingFor") or filt.get("lookingFor") or "any"
    if looking in GENDERS:
        looking = next((k for k, v in LOOKING_TO_GENDER.items() if v == looking), "any")
    prefs = {"lookingFor": looking}
    if (u.get("plan") or "free") == "paid":
        if filt.get("ageMin") is not None:
            prefs["ageMin"] = filt["ageMin"]
        if filt.get("ageMax") is not None:
            prefs["ageMax"] = filt["ageMax"]
        if filt.get("distance") is not None:
            prefs["distanceMiles"] = filt["distance"]
        if filt.get("education"):
            prefs["education"] = filt["education"]
    u["preferences"] = prefs


def prefs_match(viewer: dict, other: dict) -> bool:
    pref = viewer.get("preferences") or {}
    want = pref.get("lookingFor") or "any"
    if want in GENDERS:
        want = next((k for k, v in LOOKING_TO_GENDER.items() if v == want), "any")
    if want not in ("", "any"):
        g = LOOKING_TO_GENDER.get(want)
        if g and other.get("gender") != g:
            return False
    if (viewer.get("plan") or "free") != "paid":
        return True
    age = other.get("age")
    amin = pref.get("ageMin")
    amax = pref.get("ageMax")
    if age is not None:
        if amin is not None and age < amin:
            return False
        if amax is not None and age > amax:
            return False
    edu = pref.get("education")
    if edu and edu not in ("", "any") and other.get("education") != edu:
        return False
    return True


def meetup_radius(user: dict) -> float:
    if (user.get("plan") or "free") != "paid":
        return 50.0
    pref = user.get("preferences") or {}
    try:
        d = float(pref.get("distanceMiles") if pref.get("distanceMiles") is not None else 50)
    except (TypeError, ValueError):
        d = 50.0
    return max(1.0, min(50.0, d))


def within_miles(viewer: dict, lat: float, lon: float, miles_limit: float) -> tuple[bool, float | None]:
    if viewer.get("lat") is None or viewer.get("lon") is None:
        return False, None
    miles = haversine_mi(viewer["lat"], viewer["lon"], lat, lon)
    return miles <= miles_limit + 1e-6, miles


def serialize_request(db: dict, req: dict, viewer: dict) -> dict:
    owner = user_by_id(db, req["userId"])
    miles = None
    if viewer.get("lat") is not None and req.get("lat") is not None:
        miles = round(haversine_mi(viewer["lat"], viewer["lon"], req["lat"], req["lon"]), 1)
    responds = [serialize_respond(db, r, viewer) for r in db["responds"] if r["requestId"] == req["id"]]
    return {
        "id": req["id"],
        "user": public_user(owner, viewer) if owner else None,
        "intent": req["intent"],
        "kind": req["kind"],
        "note": req.get("note") or "",
        "livePhoto": req.get("livePhoto"),
        "lat": req.get("lat"),
        "lon": req.get("lon"),
        "miles": miles,
        "status": req.get("status") or "open",
        "offerExpiresAt": req.get("offerExpiresAt"),
        "createdAt": req.get("createdAt"),
        "isMine": req["userId"] == viewer["id"],
        "responds": responds,
        "channelId": req.get("channelId"),
    }


def serialize_respond(db: dict, rsp: dict, viewer: dict) -> dict:
    u = user_by_id(db, rsp["userId"])
    return {
        "id": rsp["id"],
        "user": public_user(u, viewer) if u else None,
        "livePhoto": rsp.get("livePhoto"),
        "note": rsp.get("note") or "",
        "status": rsp.get("status") or "pending",
        "expiresAt": rsp.get("expiresAt"),
        "createdAt": rsp.get("createdAt"),
        "isMine": rsp["userId"] == viewer["id"],
    }


def maybe_demo_respond(db: dict, req: dict) -> None:
    if req.get("demoResponded") or req.get("status") != "open":
        return
    if now_ms() - req.get("createdAt", 0) < 9000:
        return
    if any(r["requestId"] == req["id"] and r.get("status") == "pending" for r in db["responds"]):
        req["demoResponded"] = True
        return
    demos = [u for u in db["users"] if u.get("demo") and u["id"] != req["userId"]]
    if not demos:
        return
    pick = demos[req["id"].encode().hex().__hash__() % len(demos)]
    photo = pick.get("lastPhoto")
    db["responds"].append(
        {
            "id": new_id("rsp"),
            "requestId": req["id"],
            "userId": pick["id"],
            "livePhoto": photo,
            "note": "I’m nearby — yes to this.",
            "status": "pending",
            "expiresAt": now_ms() + FREE_EXPIRE_MS,
            "createdAt": now_ms(),
        }
    )
    req["demoResponded"] = True


class Handler(BaseHTTPRequestHandler):
    db: dict
    qs: dict

    def log_message(self, fmt: str, *args) -> None:
        sys_stderr = __import__("sys").stderr
        sys_stderr.write("%s - %s\n" % (self.address_string(), fmt % args))

    def _json(self, code: int, payload) -> None:
        body = json.dumps(payload).encode("utf-8")
        self.send_response(code)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Cache-Control", "no-store")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.self_write(body)

    def self_write(self, body: bytes) -> None:
        try:
            self.wfile.write(body)
        except BrokenPipeError:
            pass

    def _bytes(self, code: int, body: bytes, content_type: str, cache: str = "no-store") -> None:
        self.send_response(code)
        self.send_header("Content-Type", content_type)
        self.send_header("Cache-Control", cache)
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.self_write(body)

    def _read_json(self) -> dict:
        n = int(self.headers.get("Content-Length") or 0)
        raw = self.rfile.read(n) if n else b"{}"
        if not raw:
            return {}
        return json.loads(raw.decode("utf-8"))

    def _file(self, path: Path, cache: str = "no-store") -> None:
        if not path.exists() or not path.is_file():
            return self._json(404, {"error": "not_found"})
        ctype = mimetypes.guess_type(str(path))[0] or "application/octet-stream"
        self._bytes(200, path.read_bytes(), ctype, cache)

    def do_GET(self) -> None:
        self._dispatch("GET")

    def do_POST(self) -> None:
        self._dispatch("POST")

    def do_PUT(self) -> None:
        self._dispatch("PUT")

    def _dispatch(self, method: str) -> None:
        parsed = urlparse(self.path)
        path = parsed.path
        self.qs = parse_qs(parsed.query)
        if method == "GET" and path in ("/", "/index.html"):
            root_index = ROOT / "index.html"
            if root_index.is_file():
                return self._file(root_index)
            return self._file(STATIC / "index.html")
        if method == "GET" and path.startswith("/static/"):
            rel = path[len("/static/") :]
            target = (STATIC / rel).resolve()
            if not str(target).startswith(str(STATIC.resolve())):
                return self._json(403, {"error": "forbidden"})
            return self._file(target, "no-store")
        if method == "GET" and path.startswith("/photos/"):
            rel = path[len("/photos/") :]
            target = (PHOTOS / rel).resolve()
            if not str(target).startswith(str(PHOTOS.resolve())):
                return self._json(403, {"error": "forbidden"})
            return self._file(target, "public, max-age=3600")
        if not path.startswith("/api/"):
            return self._json(404, {"error": "not_found"})
        try:
            with LOCK:
                self.db = load_db()
                apply_expiry_filters(self.db)
                result = self._api(method, path)
                save_db(self.db)
        except ValueError as e:
            return self._json(400, {"error": str(e)})
        except PermissionError as e:
            return self._json(403, {"error": str(e)})
        except KeyError as e:
            return self._json(401, {"error": str(e)})
        except FileNotFoundError:
            return self._json(404, {"error": "not_found"})
        if result is None:
            return
        code, payload = result
        return self._json(code, payload)

    def _api(self, method: str, path: str) -> tuple[int, dict] | None:
        # Incoming path is full "/api/..."
        route = path
        if route.startswith("/api"):
            route = route[4:] or "/"
        parts = [p for p in route.split("/") if p]

        if method == "GET" and parts == ["health"]:
            return 200, {"ok": True, "app": "meet50"}

        if method == "POST" and parts == ["signup"]:
            return self._signup()
        if method == "GET" and parts == ["me"]:
            u = self._auth()
            return 200, {"user": self._me(u)}
        if method == "PUT" and parts == ["me"]:
            return self._update_me()
        if method == "PUT" and parts == ["me", "preferences"]:
            return self._update_prefs()
        if method == "POST" and parts == ["me", "plan"]:
            return self._set_plan()
        if method == "PUT" and parts == ["me", "location"]:
            return self._set_location()
        if method == "POST" and parts == ["photos", "live"]:
            return self._live_photo()
        if method == "GET" and parts == ["nearby"]:
            return self._nearby()
        if method == "POST" and parts == ["meetups"]:
            return self._create_meetup()
        if method == "GET" and parts == ["meetups"]:
            return self._list_meetups()
        if method == "GET" and len(parts) == 2 and parts[0] == "meetups":
            return self._get_meetup(parts[1])
        if method == "POST" and len(parts) == 3 and parts[0] == "meetups" and parts[2] == "responds":
            return self._respond(parts[1])
        if method == "POST" and len(parts) == 3 and parts[0] == "meetups" and parts[2] == "concur":
            return self._concur(parts[1])
        if method == "GET" and parts == ["inbox"]:
            return self._inbox()
        if method == "GET" and len(parts) == 3 and parts[0] == "channels" and parts[2] == "messages":
            return self._list_messages(parts[1])
        if method == "POST" and len(parts) == 3 and parts[0] == "channels" and parts[2] == "messages":
            return self._post_message(parts[1])
        return 404, {"error": "not_found"}

    def _auth(self) -> dict:
        u = session_user(self)
        if not u:
            raise KeyError("auth_required")
        return u

    def _me(self, u: dict) -> dict:
        p = public_user(u, u)
        filt = u.get("filter")
        p.update(
            {
                "education": u.get("education") or "",
                "filter": normalize_filter(filt) if not isinstance(filt, str) else default_filter(),
                "preferences": u.get("preferences") or {"lookingFor": "any"},
                "photos": u.get("photos") or [],
            }
        )
        return p

    def _signup(self) -> tuple[int, dict]:
        body = self._read_json()
        name = (body.get("name") or "").strip()
        if not name:
            raise ValueError("name_required")
        try:
            age = int(body.get("age"))
        except (TypeError, ValueError):
            raise ValueError("age_required")
        if age < 18 or age > 99:
            raise ValueError("age_range")
        gender = body.get("gender")
        if gender not in GENDERS:
            raise ValueError("gender_invalid")
        marital = body.get("maritalStatus") or "prefer_not"
        if marital not in MARITAL:
            raise ValueError("marital_invalid")
        looking = body.get("lookingFor") or "any"
        if looking not in ("any",) + LOOKING:
            raise ValueError("looking_invalid")
        education = body.get("education") or ""
        if education and education not in EDUCATION:
            raise ValueError("education_invalid")
        uid = new_id("usr")
        token = secrets.token_urlsafe(24)
        t = now_ms()
        saved_filter = normalize_filter(body.get("filter") if isinstance(body.get("filter"), dict) else {
            "lookingFor": looking if looking != "any" else "any",
            "education": education or "any",
            "distance": body.get("distance"),
            "ageMin": body.get("ageMin"),
            "ageMax": body.get("ageMax"),
        })
        user = {
            "id": uid,
            "demo": False,
            "plan": "free",
            "name": name,
            "age": age,
            "gender": gender,
            "homeCity": (body.get("homeCity") or "").strip(),
            "job": (body.get("job") or "").strip(),
            "maritalStatus": marital,
            "bio": (body.get("bio") or "").strip(),
            "lookingFor": looking,
            "education": education or "bachelor",
            "filter": saved_filter,
            "lastPhoto": None,
            "photos": [],
            "livePhotos": {},
            "preferences": {"lookingFor": looking if looking != "any" else saved_filter["lookingFor"]},
            "lat": None,
            "lon": None,
            "locationUpdatedAt": None,
            "createdAt": t,
        }
        sync_prefs_from_profile(user)
        self.db["users"].append(user)
        self.db["sessions"][token] = uid
        return 200, {"token": token, "user": self._me(user)}

    def _update_me(self) -> tuple[int, dict]:
        u = self._auth()
        body = self._read_json()
        for key in ("name", "homeCity", "job", "bio"):
            if key in body and isinstance(body[key], str):
                u[key] = body[key].strip()
        if "age" in body:
            try:
                age = int(body["age"])
            except (TypeError, ValueError):
                raise ValueError("age_required")
            if age < 18 or age > 99:
                raise ValueError("age_range")
            u["age"] = age
        if "gender" in body:
            if body["gender"] not in GENDERS:
                raise ValueError("gender_invalid")
            u["gender"] = body["gender"]
        if "maritalStatus" in body:
            if body["maritalStatus"] not in MARITAL:
                raise ValueError("marital_invalid")
            u["maritalStatus"] = body["maritalStatus"]
        if "lookingFor" in body:
            looking = body["lookingFor"]
            if looking not in ("any",) + LOOKING:
                raise ValueError("looking_invalid")
            u["lookingFor"] = looking
        if "education" in body:
            education = body["education"]
            if education not in EDUCATION:
                raise ValueError("education_invalid")
            u["education"] = education
        if "filter" in body:
            u["filter"] = normalize_filter(body["filter"])
        sync_prefs_from_profile(u)
        return 200, {"user": self._me(u)}

    def _update_prefs(self) -> tuple[int, dict]:
        u = self._auth()
        body = self._read_json()
        looking = body.get("lookingFor") or "any"
        if looking in GENDERS:
            looking = next((k for k, v in LOOKING_TO_GENDER.items() if v == looking), "any")
        if looking not in ("any",) + LOOKING:
            raise ValueError("looking_invalid")
        prefs = {"lookingFor": looking}
        if (u.get("plan") or "free") == "paid":
            if body.get("ageMin") is not None:
                prefs["ageMin"] = int(body["ageMin"])
            if body.get("ageMax") is not None:
                prefs["ageMax"] = int(body["ageMax"])
            if body.get("distanceMiles") is not None:
                prefs["distanceMiles"] = max(1, min(50, int(body["distanceMiles"])))
            if body.get("education"):
                edu = body["education"]
                if edu not in ("any",) + EDUCATION:
                    raise ValueError("education_invalid")
                prefs["education"] = edu
            if body.get("timeFrom"):
                prefs["timeFrom"] = str(body["timeFrom"])
            if body.get("timeTo"):
                prefs["timeTo"] = str(body["timeTo"])
        u["preferences"] = prefs
        return 200, {"user": self._me(u)}

    def _set_plan(self) -> tuple[int, dict]:
        u = self._auth()
        body = self._read_json()
        plan = body.get("plan")
        if plan not in ("free", "paid"):
            raise ValueError("plan_invalid")
        u["plan"] = plan
        if plan == "free":
            looking = (u.get("preferences") or {}).get("lookingFor") or u.get("lookingFor") or "any"
            u["preferences"] = {"lookingFor": looking}
        else:
            sync_prefs_from_profile(u)
        return 200, {"user": self._me(u)}

    def _set_location(self) -> tuple[int, dict]:
        u = self._auth()
        body = self._read_json()
        try:
            lat = float(body["lat"])
            lon = float(body["lon"])
        except (KeyError, TypeError, ValueError):
            raise ValueError("lat_lon_required")
        if not (-90 <= lat <= 90 and -180 <= lon <= 180):
            raise ValueError("lat_lon_invalid")
        u["lat"] = lat
        u["lon"] = lon
        u["locationUpdatedAt"] = now_ms()
        place_demos_around(self.db, lat, lon)
        return 200, {"user": self._me(u)}

    def _live_photo(self) -> tuple[int, dict]:
        u = self._auth()
        body = self._read_json()
        data_url = body.get("image") or ""
        captured = int(body.get("capturedAt") or now_ms())
        m = re.match(r"^data:image/(jpeg|jpg|png|webp);base64,(.+)$", data_url, re.I | re.S)
        if not m:
            raise ValueError("image_required")
        ext = m.group(1).lower()
        if ext == "jpg":
            ext = "jpeg"
        raw = base64.b64decode(m.group(2))
        if not raw or len(raw) > MAX_PHOTO_BYTES:
            raise ValueError("image_size")
        pid = new_id("ph")
        PHOTOS.mkdir(parents=True, exist_ok=True)
        filename = f"{pid}.{ext}"
        (PHOTOS / filename).write_bytes(raw)
        url = f"/photos/{filename}"
        u.setdefault("livePhotos", {})[pid] = {
            "url": url,
            "capturedAt": captured,
        }
        u["lastPhoto"] = url
        photos = u.setdefault("photos", [])
        photos.append(url)
        u["photos"] = photos[-12:]
        return 200, {"photoId": pid, "url": url, "capturedAt": captured, "user": self._me(u)}

    def _nearby(self) -> tuple[int, dict]:
        u = self._auth()
        if u.get("lat") is None:
            raise ValueError("location_required")
        place_demos_around(self.db, u["lat"], u["lon"])
        people = []
        for other in self.db["users"]:
            if other["id"] == u["id"]:
                continue
            if other.get("lat") is None:
                continue
            ok, miles = within_miles(u, other["lat"], other["lon"], 50.0)
            if not ok:
                continue
            if (now_ms() - (other.get("locationUpdatedAt") or 0)) > ACTIVITY_TTL_MS:
                continue
            people.append(public_user(other, u))
        people.sort(key=lambda p: p.get("miles") if p.get("miles") is not None else 999)
        feed_radius = meetup_radius(u)
        meetups = []
        for req in self.db["requests"]:
            maybe_demo_respond(self.db, req)
            if req.get("status") != "open":
                continue
            if req.get("lat") is None:
                continue
            ok, _miles = within_miles(u, req["lat"], req["lon"], feed_radius)
            if not ok:
                continue
            owner = user_by_id(self.db, req["userId"])
            if owner and not prefs_match(u, owner) and req["userId"] != u["id"]:
                continue
            meetups.append(serialize_request(self.db, req, u))
        return 200, {
            "me": public_user(u, u),
            "radiusMiles": 50,
            "feedRadiusMiles": feed_radius,
            "people": people,
            "meetups": meetups,
        }

    def _create_meetup(self) -> tuple[int, dict]:
        u = self._auth()
        body = self._read_json()
        if u.get("lat") is None:
            raise ValueError("location_required")
        photo_id = body.get("photoId")
        if not live_photo_ok(u, photo_id):
            raise ValueError("live_photo_required")
        intent = body.get("intent")
        kind = body.get("kind")
        if intent not in INTENTS or kind not in KINDS:
            raise ValueError("offer_ask_invalid")
        paid = (u.get("plan") or "free") == "paid"
        if paid and body.get("expireMinutes") is not None:
            try:
                mins = int(body["expireMinutes"])
            except (TypeError, ValueError):
                raise ValueError("expiry_invalid")
            mins = max(1, min(7 * 24 * 60, mins))
            exp = now_ms() + mins * 60 * 1000
        elif paid and body.get("offerExpiresAt"):
            exp = int(body["offerExpiresAt"])
            if exp < now_ms() + 60_000:
                raise ValueError("expiry_too_soon")
            if exp > now_ms() + 7 * 24 * 3600 * 1000:
                raise ValueError("expiry_too_far")
        else:
            exp = now_ms() + FREE_EXPIRE_MS
        live = (u.get("livePhotos") or {})[photo_id]
        req = {
            "id": new_id("req"),
            "userId": u["id"],
            "intent": intent,
            "kind": kind,
            "note": (body.get("note") or "").strip()[:280],
            "livePhoto": live["url"],
            "photoId": photo_id,
            "lat": u["lat"],
            "lon": u["lon"],
            "status": "open",
            "offerExpiresAt": exp,
            "createdAt": now_ms(),
            "channelId": None,
            "demoResponded": False,
        }
        self.db["requests"].append(req)
        return 200, {"meetup": serialize_request(self.db, req, u)}

    def _list_meetups(self) -> tuple[int, dict]:
        u = self._auth()
        mine = [serialize_request(self.db, r, u) for r in self.db["requests"] if r["userId"] == u["id"]]
        mine.sort(key=lambda r: r["createdAt"], reverse=True)
        return 200, {"meetups": mine}

    def _get_meetup(self, mid: str) -> tuple[int, dict]:
        u = self._auth()
        req = next((r for r in self.db["requests"] if r["id"] == mid), None)
        if not req:
            raise FileNotFoundError()
        maybe_demo_respond(self.db, req)
        return 200, {"meetup": serialize_request(self.db, req, u)}

    def _respond(self, mid: str) -> tuple[int, dict]:
        u = self._auth()
        req = next((r for r in self.db["requests"] if r["id"] == mid), None)
        if not req:
            raise FileNotFoundError()
        if req.get("status") != "open":
            raise ValueError("request_closed")
        if req["userId"] == u["id"]:
            raise ValueError("cannot_respond_own")
        return self._respond_with(u, req, self._read_json())

    def _respond_with(self, u: dict, req: dict, body: dict) -> tuple[int, dict]:
        photo_id = body.get("photoId")
        if not live_photo_ok(u, photo_id):
            raise ValueError("live_photo_required")
        existing = next(
            (
                r
                for r in self.db["responds"]
                if r["requestId"] == req["id"] and r["userId"] == u["id"] and r.get("status") == "pending"
            ),
            None,
        )
        if existing:
            raise ValueError("already_responded")
        paid = (u.get("plan") or "free") == "paid"
        live = (u.get("livePhotos") or {})[photo_id]
        rsp = {
            "id": new_id("rsp"),
            "requestId": req["id"],
            "userId": u["id"],
            "livePhoto": live["url"],
            "note": (body.get("note") or "").strip()[:280],
            "status": "pending",
            "expiresAt": None if paid else now_ms() + FREE_EXPIRE_MS,
            "createdAt": now_ms(),
        }
        self.db["responds"].append(rsp)
        return 200, {
            "respond": serialize_respond(self.db, rsp, u),
            "meetup": serialize_request(self.db, req, u),
        }

    def _concur(self, mid: str) -> tuple[int, dict]:
        u = self._auth()
        body = self._read_json()
        req = next((r for r in self.db["requests"] if r["id"] == mid), None)
        if not req:
            raise FileNotFoundError()
        if req["userId"] != u["id"]:
            raise PermissionError("initiator_only")
        if req.get("status") != "open":
            raise ValueError("request_closed")
        rid = body.get("respondId")
        rsp = next((r for r in self.db["responds"] if r["id"] == rid and r["requestId"] == mid), None)
        if not rsp:
            raise FileNotFoundError()
        if rsp.get("status") != "pending" or expired(rsp.get("expiresAt")):
            raise ValueError("respond_expired")
        ch_id = new_id("ch")
        channel = {
            "id": ch_id,
            "requestId": mid,
            "userIds": [req["userId"], rsp["userId"]],
            "createdAt": now_ms(),
        }
        self.db["channels"].append(channel)
        req["status"] = "matched"
        req["channelId"] = ch_id
        rsp["status"] = "concurred"
        for other in self.db["responds"]:
            if other["requestId"] == mid and other["id"] != rid and other.get("status") == "pending":
                other["status"] = "closed"
        self.db["messages"].append(
            {
                "id": new_id("msg"),
                "channelId": ch_id,
                "userId": u["id"],
                "text": "Channel open. Text only from here.",
                "createdAt": now_ms(),
                "system": True,
            }
        )
        return 200, {
            "channelId": ch_id,
            "meetup": serialize_request(self.db, req, u),
        }

    def _inbox(self) -> tuple[int, dict]:
        u = self._auth()
        incoming = []
        outgoing = []
        channels = []
        for req in self.db["requests"]:
            maybe_demo_respond(self.db, req)
            if req["userId"] == u["id"]:
                incoming.append(serialize_request(self.db, req, u))
        for rsp in self.db["responds"]:
            if rsp["userId"] == u["id"]:
                req = next((r for r in self.db["requests"] if r["id"] == rsp["requestId"]), None)
                if req:
                    outgoing.append(
                        {
                            "respond": serialize_respond(self.db, rsp, u),
                            "meetup": serialize_request(self.db, req, u),
                        }
                    )
        for ch in self.db["channels"]:
            if u["id"] in ch["userIds"]:
                other_id = next(i for i in ch["userIds"] if i != u["id"])
                other = user_by_id(self.db, other_id)
                last = next(
                    (m for m in reversed(self.db["messages"]) if m["channelId"] == ch["id"]),
                    None,
                )
                channels.append(
                    {
                        "id": ch["id"],
                        "requestId": ch["requestId"],
                        "other": public_user(other, u) if other else None,
                        "createdAt": ch["createdAt"],
                        "lastText": (last or {}).get("text") or "",
                    }
                )
        return 200, {"incoming": incoming, "outgoing": outgoing, "channels": channels}

    def _channel(self, cid: str, u: dict) -> dict:
        ch = next((c for c in self.db["channels"] if c["id"] == cid), None)
        if not ch:
            raise FileNotFoundError()
        if u["id"] not in ch["userIds"]:
            raise PermissionError("not_member")
        return ch

    def _list_messages(self, cid: str) -> tuple[int, dict]:
        u = self._auth()
        ch = self._channel(cid, u)
        msgs = [
            {
                "id": m["id"],
                "text": m["text"],
                "createdAt": m["createdAt"],
                "system": bool(m.get("system")),
                "isMine": m["userId"] == u["id"],
                "userId": m["userId"],
            }
            for m in self.db["messages"]
            if m["channelId"] == cid
        ]
        other_id = next(i for i in ch["userIds"] if i != u["id"])
        other = user_by_id(self.db, other_id)
        return 200, {
            "channelId": cid,
            "other": public_user(other, u) if other else None,
            "messages": msgs,
        }

    def _post_message(self, cid: str) -> tuple[int, dict]:
        u = self._auth()
        self._channel(cid, u)
        body = self._read_json()
        text = (body.get("text") or "").strip()
        if not text:
            raise ValueError("text_required")
        if len(text) > 1000:
            raise ValueError("text_too_long")
        msg = {
            "id": new_id("msg"),
            "channelId": cid,
            "userId": u["id"],
            "text": text,
            "createdAt": now_ms(),
            "system": False,
        }
        self.db["messages"].append(msg)
        ch = next((c for c in self.db["channels"] if c["id"] == cid), None)
        reply = None
        if ch:
            other_id = next((i for i in ch["userIds"] if i != u["id"]), None)
            other = user_by_id(self.db, other_id) if other_id else None
            if other and other.get("demo"):
                reply = {
                    "id": new_id("msg"),
                    "channelId": cid,
                    "userId": other["id"],
                    "text": "On my way — see you there.",
                    "createdAt": now_ms() + 400,
                    "system": False,
                }
                self.db["messages"].append(reply)
        payload = {
            "message": {
                "id": msg["id"],
                "text": msg["text"],
                "createdAt": msg["createdAt"],
                "system": False,
                "isMine": True,
                "userId": u["id"],
            }
        }
        if reply:
            payload["reply"] = {
                "id": reply["id"],
                "text": reply["text"],
                "createdAt": reply["createdAt"],
                "system": False,
                "isMine": False,
                "userId": reply["userId"],
            }
        return 200, payload


def main() -> None:
    DATA.mkdir(parents=True, exist_ok=True)
    PHOTOS.mkdir(parents=True, exist_ok=True)
    STATIC.mkdir(parents=True, exist_ok=True)
    if not DB_PATH.exists():
        save_db(empty_db())
    server = ThreadingHTTPServer(("127.0.0.1", PORT), Handler)
    print(f"Meet50 http://127.0.0.1:{PORT}", flush=True)
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        print("\nstopped", flush=True)
        server.server_close()


if __name__ == "__main__":
    main()
