/**
 * Meet50 API — Cloudflare Worker + KV (free).
 * Same routes as local app.py. GitHub Pages is the UI only.
 */
const R_EARTH_MI = 3958.7613;
const ACTIVITY_TTL_MS = 30 * 60 * 1000;
const FREE_EXPIRE_MS = 30 * 60 * 1000;
const MAX_PHOTO_BYTES = 2_500_000;
const GENDERS = ["woman", "man", "nonbinary"];
const LOOKING = ["male", "female", "lgbtq"];
const EDUCATION = ["high_school", "associate", "bachelor", "master", "doctorate", "other"];
const LOOKING_TO_GENDER = { male: "man", female: "woman", lgbtq: "nonbinary" };
const INTENTS = ["offer", "ask"];
const KINDS = ["drink", "meal"];
const MARITAL = ["single", "partnered", "married", "divorced", "prefer_not"];
const ALLOW_ORIGINS = [
  "https://dvpwemake.github.io",
  "http://127.0.0.1:5055",
  "http://localhost:5055",
];

const DEMO_PEOPLE = [
  { name: "Avery Chen", age: 31, gender: "woman", homeCity: "Fremont", job: "Product designer", maritalStatus: "single", bio: "Walks, bookstores, and one good espresso.", lookingFor: "male", education: "bachelor", color: "#ff5a1f", offset: [0.11, 0.07] },
  { name: "Jules Okonkwo", age: 36, gender: "man", homeCity: "Ballard", job: "Civil engineer", maritalStatus: "divorced", bio: "Builds bridges. Cooks too much pasta.", lookingFor: "female", education: "master", color: "#7ec8a3", offset: [-0.16, 0.12] },
  { name: "Sam Rivera", age: 28, gender: "nonbinary", homeCity: "Capitol Hill", job: "Sound tech", maritalStatus: "single", bio: "Venues, vinyl, and a 10pm curfew on weekdays.", lookingFor: "lgbtq", education: "associate", color: "#c9a227", offset: [0.04, -0.19] },
  { name: "Mina Park", age: 41, gender: "woman", homeCity: "West Seattle", job: "ER nurse", maritalStatus: "single", bio: "Night shifts. Honest mornings.", lookingFor: "male", education: "bachelor", color: "#6ea8ff", offset: [0.22, -0.05] },
];

class HttpError extends Error {
  constructor(status, error) {
    super(error);
    this.status = status;
    this.error = error;
  }
}

function nowMs() {
  return Date.now();
}

function newId(prefix) {
  const bytes = crypto.getRandomValues(new Uint8Array(6));
  const hex = [...bytes].map((b) => b.toString(16).padStart(2, "0")).join("");
  return `${prefix}_${hex}`;
}

function emptyDb() {
  return { users: [], sessions: {}, requests: [], responds: [], channels: [], messages: [], demos_placed: false };
}

function corsHeaders(origin) {
  const allow = ALLOW_ORIGINS.includes(origin) ? origin : ALLOW_ORIGINS[0];
  return {
    "Access-Control-Allow-Origin": allow,
    "Access-Control-Allow-Headers": "Authorization, Content-Type",
    "Access-Control-Allow-Methods": "GET, POST, PUT, OPTIONS",
    "Access-Control-Max-Age": "86400",
    Vary: "Origin",
  };
}

function json(status, payload, origin) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store", ...corsHeaders(origin) },
  });
}

function haversineMi(aLat, aLon, bLat, bLon) {
  const p1 = (aLat * Math.PI) / 180;
  const p2 = (bLat * Math.PI) / 180;
  const dphi = ((bLat - aLat) * Math.PI) / 180;
  const dlmb = ((bLon - aLon) * Math.PI) / 180;
  const h = Math.sin(dphi / 2) ** 2 + Math.cos(p1) * Math.cos(p2) * Math.sin(dlmb / 2) ** 2;
  return 2 * R_EARTH_MI * Math.asin(Math.min(1, Math.sqrt(h)));
}

function defaultFilter() {
  return { education: "any", distance: 50, ageMin: 18, ageMax: 99, lookingFor: "any" };
}

function normalizeFilter(raw) {
  const base = defaultFilter();
  if (!raw || typeof raw !== "object") return base;
  let edu = raw.education || "any";
  if (![ "any", ...EDUCATION].includes(edu)) edu = "any";
  let look = raw.lookingFor || "any";
  if (![ "any", ...LOOKING].includes(look)) look = "any";
  let dist = Number(raw.distance);
  if (!Number.isFinite(dist)) dist = 50;
  dist = Math.max(1, Math.min(50, dist | 0));
  let amin = Number(raw.ageMin);
  let amax = Number(raw.ageMax);
  if (!Number.isFinite(amin)) amin = 18;
  if (!Number.isFinite(amax)) amax = 99;
  amin = Math.max(18, Math.min(99, amin | 0));
  amax = Math.max(18, Math.min(99, amax | 0));
  if (amin > amax) [amin, amax] = [amax, amin];
  return { education: edu, distance: dist, ageMin: amin, ageMax: amax, lookingFor: look };
}

function initials(name) {
  const parts = String(name || "").split(/\s+/).filter(Boolean);
  if (!parts.length) return "?";
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
}

function svgPhoto(name, color) {
  const safe = initials(name).replace(/[^A-Za-z0-9 ]/g, "").slice(0, 3) || "?";
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="640" height="640" viewBox="0 0 640 640"><rect width="640" height="640" fill="#16150f"/><circle cx="320" cy="320" r="220" fill="${color}"/><text x="320" y="360" text-anchor="middle" font-family="Georgia, serif" font-size="180" fill="#0e0f0c">${safe}</text></svg>`;
  return "data:image/svg+xml;utf8," + encodeURIComponent(svg);
}

function userById(db, uid) {
  return db.users.find((u) => u.id === uid) || null;
}

function expired(ts) {
  if (ts == null) return false;
  return nowMs() >= ts;
}

function applyExpiry(db) {
  const t = nowMs();
  for (const req of db.requests) {
    if (req.status === "open" && req.offerExpiresAt && t >= req.offerExpiresAt) req.status = "expired";
  }
  for (const rsp of db.responds) {
    if (rsp.status === "pending" && rsp.expiresAt && t >= rsp.expiresAt) rsp.status = "expired";
  }
}

function syncPrefs(u) {
  const filt = u.filter && typeof u.filter === "object" ? u.filter : defaultFilter();
  let looking = u.lookingFor || filt.lookingFor || "any";
  if (GENDERS.includes(looking)) {
    looking = Object.keys(LOOKING_TO_GENDER).find((k) => LOOKING_TO_GENDER[k] === looking) || "any";
  }
  const prefs = { lookingFor: looking };
  if ((u.plan || "free") === "paid") {
    if (filt.ageMin != null) prefs.ageMin = filt.ageMin;
    if (filt.ageMax != null) prefs.ageMax = filt.ageMax;
    if (filt.distance != null) prefs.distanceMiles = filt.distance;
    if (filt.education) prefs.education = filt.education;
  }
  u.preferences = prefs;
}

function publicUser(u, viewer) {
  let miles = null;
  if (viewer && viewer.lat != null && u.lat != null) miles = Math.round(haversineMi(viewer.lat, viewer.lon, u.lat, u.lon) * 10) / 10;
  const active = u.lat != null && nowMs() - (u.locationUpdatedAt || 0) <= ACTIVITY_TTL_MS;
  return {
    id: u.id,
    demo: !!u.demo,
    plan: u.plan || "free",
    name: u.name,
    age: u.age,
    gender: u.gender,
    homeCity: u.homeCity,
    job: u.job,
    maritalStatus: u.maritalStatus,
    bio: u.bio,
    lookingFor: u.lookingFor,
    education: u.education,
    lastPhoto: u.lastPhoto,
    lat: u.lat,
    lon: u.lon,
    active,
    miles,
    isMe: !!(viewer && u.id === viewer.id),
  };
}

function meDto(u) {
  const p = publicUser(u, u);
  const filt = u.filter;
  p.education = u.education || "";
  p.filter = typeof filt === "string" ? defaultFilter() : normalizeFilter(filt);
  p.preferences = u.preferences || { lookingFor: "any" };
  p.photos = u.photos || [];
  return p;
}

function prefsMatch(viewer, other) {
  const pref = viewer.preferences || {};
  let want = pref.lookingFor || "any";
  if (GENDERS.includes(want)) want = Object.keys(LOOKING_TO_GENDER).find((k) => LOOKING_TO_GENDER[k] === want) || "any";
  if (want && want !== "any") {
    const g = LOOKING_TO_GENDER[want];
    if (g && other.gender !== g) return false;
  }
  if ((viewer.plan || "free") !== "paid") return true;
  const age = other.age;
  if (age != null) {
    if (pref.ageMin != null && age < pref.ageMin) return false;
    if (pref.ageMax != null && age > pref.ageMax) return false;
  }
  const edu = pref.education;
  if (edu && edu !== "any" && other.education !== edu) return false;
  return true;
}

function meetupRadius(user) {
  if ((user.plan || "free") !== "paid") return 50;
  const d = Number((user.preferences || {}).distanceMiles);
  if (!Number.isFinite(d)) return 50;
  return Math.max(1, Math.min(50, d));
}

function withinMiles(viewer, lat, lon, limit) {
  if (viewer.lat == null || viewer.lon == null) return [false, null];
  const miles = haversineMi(viewer.lat, viewer.lon, lat, lon);
  return [miles <= limit + 1e-6, miles];
}

function livePhotoOk(user, photoId) {
  if (!photoId) return false;
  const meta = (user.livePhotos || {})[photoId];
  if (!meta) return false;
  const age = nowMs() - Number(meta.capturedAt || 0);
  return age >= 0 && age <= 10 * 60 * 1000;
}

function serializeRespond(db, rsp, viewer) {
  const u = userById(db, rsp.userId);
  return {
    id: rsp.id,
    user: u ? publicUser(u, viewer) : null,
    livePhoto: rsp.livePhoto,
    note: rsp.note || "",
    status: rsp.status || "pending",
    expiresAt: rsp.expiresAt,
    createdAt: rsp.createdAt,
    isMine: rsp.userId === viewer.id,
  };
}

function serializeRequest(db, req, viewer) {
  const owner = userById(db, req.userId);
  let miles = null;
  if (viewer.lat != null && req.lat != null) miles = Math.round(haversineMi(viewer.lat, viewer.lon, req.lat, req.lon) * 10) / 10;
  return {
    id: req.id,
    user: owner ? publicUser(owner, viewer) : null,
    intent: req.intent,
    kind: req.kind,
    note: req.note || "",
    livePhoto: req.livePhoto,
    lat: req.lat,
    lon: req.lon,
    miles,
    status: req.status || "open",
    offerExpiresAt: req.offerExpiresAt,
    createdAt: req.createdAt,
    isMine: req.userId === viewer.id,
    responds: db.responds.filter((r) => r.requestId === req.id).map((r) => serializeRespond(db, r, viewer)),
    channelId: req.channelId,
  };
}

function placeDemos(db, lat, lon) {
  const t = nowMs();
  const existing = db.users.filter((u) => u.demo);
  if (!existing.length) {
    for (const person of DEMO_PEOPLE) {
      const uid = newId("usr");
      const photo = svgPhoto(person.name, person.color);
      db.users.push({
        id: uid,
        demo: true,
        plan: "free",
        name: person.name,
        age: person.age,
        gender: person.gender,
        homeCity: person.homeCity,
        job: person.job,
        maritalStatus: person.maritalStatus,
        bio: person.bio,
        lookingFor: person.lookingFor,
        education: person.education,
        filter: defaultFilter(),
        lastPhoto: photo,
        photos: [photo],
        preferences: { lookingFor: "any" },
        lat: lat + person.offset[0],
        lon: lon + person.offset[1],
        locationUpdatedAt: t,
        createdAt: t,
      });
    }
    db.demos_placed = true;
    return;
  }
  DEMO_PEOPLE.forEach((person, i) => {
    const u = existing[i];
    if (!u) return;
    u.lat = lat + person.offset[0];
    u.lon = lon + person.offset[1];
    u.locationUpdatedAt = t;
    u.lookingFor = person.lookingFor;
    u.education = person.education || "bachelor";
  });
}

function maybeDemoRespond(db, req) {
  if (req.demoResponded || req.status !== "open") return;
  if (nowMs() - (req.createdAt || 0) < 9000) return;
  if (db.responds.some((r) => r.requestId === req.id && r.status === "pending")) {
    req.demoResponded = true;
    return;
  }
  const demos = db.users.filter((u) => u.demo && u.id !== req.userId);
  if (!demos.length) return;
  const pick = demos[Math.abs(hashCode(req.id)) % demos.length];
  db.responds.push({
    id: newId("rsp"),
    requestId: req.id,
    userId: pick.id,
    livePhoto: pick.lastPhoto,
    note: "I’m nearby — yes to this.",
    status: "pending",
    expiresAt: nowMs() + FREE_EXPIRE_MS,
    createdAt: nowMs(),
  });
  req.demoResponded = true;
}

function hashCode(s) {
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) | 0;
  return h;
}

function authUser(req, db) {
  const header = req.headers.get("Authorization") || "";
  const token = header.toLowerCase().startsWith("bearer ") ? header.slice(7).trim() : new URL(req.url).searchParams.get("token") || "";
  if (!token) throw new HttpError(401, "auth_required");
  const uid = db.sessions[token];
  const u = uid ? userById(db, uid) : null;
  if (!u) throw new HttpError(401, "auth_required");
  return u;
}

async function loadDb(env) {
  const raw = await env.MEET50.get("db");
  if (!raw) return emptyDb();
  try {
    return { ...emptyDb(), ...JSON.parse(raw) };
  } catch {
    return emptyDb();
  }
}

async function saveDb(env, db) {
  await env.MEET50.put("db", JSON.stringify(db));
}

async function handle(req, env) {
  const url = new URL(req.url);
  const origin = req.headers.get("Origin") || "";
  if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: corsHeaders(origin) });

  let path = url.pathname.replace(/\/+$/, "") || "/";
  if (path === "/health" || path === "/api/health") return json(200, { ok: true, app: "meet50", store: "cloudflare-kv" }, origin);
  if (!path.startsWith("/api/")) return json(404, { error: "not_found" }, origin);

  const parts = path.slice(5).split("/").filter(Boolean);
  const db = await loadDb(env);
  applyExpiry(db);
  let body = {};
  if (req.method !== "GET" && req.method !== "HEAD") {
    try {
      body = await req.json();
    } catch {
      body = {};
    }
  }

  const ctx = { req, db, body, origin };

  try {
    const result = await route(req.method, parts, ctx);
    await saveDb(env, db);
    return json(result[0], result[1], origin);
  } catch (err) {
    if (err instanceof HttpError) return json(err.status, { error: err.error }, origin);
    return json(500, { error: String(err.message || err) }, origin);
  }
}

async function route(method, parts, ctx) {
  const { db, body, req } = ctx;
  if (method === "GET" && parts[0] === "health") return [200, { ok: true, app: "meet50" }];
  if (method === "POST" && parts.join("/") === "signup") return signup(db, body);
  const u = () => authUser(req, db);
  if (method === "GET" && parts.join("/") === "me") return [200, { user: meDto(u()) }];
  if (method === "PUT" && parts.join("/") === "me") return updateMe(u(), body);
  if (method === "PUT" && parts.join("/") === "me/preferences") return updatePrefs(u(), body);
  if (method === "POST" && parts.join("/") === "me/plan") return setPlan(u(), body);
  if (method === "PUT" && parts.join("/") === "me/location") return setLocation(db, u(), body);
  if (method === "POST" && parts.join("/") === "photos/live") return livePhoto(u(), body);
  if (method === "GET" && parts.join("/") === "nearby") return nearby(db, u());
  if (method === "POST" && parts.join("/") === "meetups") return createMeetup(db, u(), body);
  if (method === "GET" && parts.join("/") === "meetups") return listMeetups(db, u());
  if (method === "GET" && parts.length === 2 && parts[0] === "meetups") return getMeetup(db, u(), parts[1]);
  if (method === "POST" && parts.length === 3 && parts[0] === "meetups" && parts[2] === "responds") return respond(db, u(), parts[1], body);
  if (method === "POST" && parts.length === 3 && parts[0] === "meetups" && parts[2] === "concur") return concur(db, u(), parts[1], body);
  if (method === "GET" && parts.join("/") === "inbox") return inbox(db, u());
  if (method === "GET" && parts.length === 3 && parts[0] === "channels" && parts[2] === "messages") return listMessages(db, u(), parts[1]);
  if (method === "POST" && parts.length === 3 && parts[0] === "channels" && parts[2] === "messages") return postMessage(db, u(), parts[1], body);
  throw new HttpError(404, "not_found");
}

function signup(db, body) {
  const name = String(body.name || "").trim();
  if (!name) throw new HttpError(400, "name_required");
  const age = Number(body.age);
  if (!Number.isFinite(age)) throw new HttpError(400, "age_required");
  if (age < 18 || age > 99) throw new HttpError(400, "age_range");
  if (!GENDERS.includes(body.gender)) throw new HttpError(400, "gender_invalid");
  const marital = body.maritalStatus || "prefer_not";
  if (!MARITAL.includes(marital)) throw new HttpError(400, "marital_invalid");
  const looking = body.lookingFor || "any";
  if (![ "any", ...LOOKING].includes(looking)) throw new HttpError(400, "looking_invalid");
  const education = body.education || "bachelor";
  if (education && !EDUCATION.includes(education)) throw new HttpError(400, "education_invalid");
  const uid = newId("usr");
  const token = newId("tok").slice(4);
  const saved = normalizeFilter(body.filter && typeof body.filter === "object" ? body.filter : { lookingFor: looking, education: education || "any" });
  const user = {
    id: uid,
    demo: false,
    plan: "free",
    name,
    age,
    gender: body.gender,
    homeCity: String(body.homeCity || "").trim(),
    job: String(body.job || "").trim(),
    maritalStatus: marital,
    bio: String(body.bio || "").trim(),
    lookingFor: looking,
    education: education || "bachelor",
    filter: saved,
    lastPhoto: null,
    photos: [],
    livePhotos: {},
    preferences: { lookingFor: looking === "any" ? saved.lookingFor : looking },
    lat: null,
    lon: null,
    locationUpdatedAt: null,
    createdAt: nowMs(),
  };
  syncPrefs(user);
  db.users.push(user);
  db.sessions[token] = uid;
  return [200, { token, user: meDto(user) }];
}

function updateMe(u, body) {
  for (const key of ["name", "homeCity", "job", "bio"]) {
    if (typeof body[key] === "string") u[key] = body[key].trim();
  }
  if (body.age != null) {
    const age = Number(body.age);
    if (!Number.isFinite(age) || age < 18 || age > 99) throw new HttpError(400, "age_range");
    u.age = age;
  }
  if (body.gender) {
    if (!GENDERS.includes(body.gender)) throw new HttpError(400, "gender_invalid");
    u.gender = body.gender;
  }
  if (body.maritalStatus) {
    if (!MARITAL.includes(body.maritalStatus)) throw new HttpError(400, "marital_invalid");
    u.maritalStatus = body.maritalStatus;
  }
  if (body.lookingFor) {
    if (![ "any", ...LOOKING].includes(body.lookingFor)) throw new HttpError(400, "looking_invalid");
    u.lookingFor = body.lookingFor;
  }
  if (body.education) {
    if (!EDUCATION.includes(body.education)) throw new HttpError(400, "education_invalid");
    u.education = body.education;
  }
  if (body.filter) u.filter = normalizeFilter(body.filter);
  syncPrefs(u);
  return [200, { user: meDto(u) }];
}

function updatePrefs(u, body) {
  let looking = body.lookingFor || "any";
  if (GENDERS.includes(looking)) looking = Object.keys(LOOKING_TO_GENDER).find((k) => LOOKING_TO_GENDER[k] === looking) || "any";
  if (![ "any", ...LOOKING].includes(looking)) throw new HttpError(400, "looking_invalid");
  const prefs = { lookingFor: looking };
  if ((u.plan || "free") === "paid") {
    if (body.ageMin != null) prefs.ageMin = Number(body.ageMin);
    if (body.ageMax != null) prefs.ageMax = Number(body.ageMax);
    if (body.distanceMiles != null) prefs.distanceMiles = Math.max(1, Math.min(50, Number(body.distanceMiles)));
    if (body.education) {
      if (![ "any", ...EDUCATION].includes(body.education)) throw new HttpError(400, "education_invalid");
      prefs.education = body.education;
    }
    if (body.timeFrom) prefs.timeFrom = String(body.timeFrom);
    if (body.timeTo) prefs.timeTo = String(body.timeTo);
  }
  u.preferences = prefs;
  return [200, { user: meDto(u) }];
}

function setPlan(u, body) {
  if (body.plan !== "free" && body.plan !== "paid") throw new HttpError(400, "plan_invalid");
  u.plan = body.plan;
  if (u.plan === "free") u.preferences = { lookingFor: (u.preferences || {}).lookingFor || u.lookingFor || "any" };
  else syncPrefs(u);
  return [200, { user: meDto(u) }];
}

function setLocation(db, u, body) {
  const lat = Number(body.lat);
  const lon = Number(body.lon);
  if (!Number.isFinite(lat) || !Number.isFinite(lon)) throw new HttpError(400, "lat_lon_required");
  if (lat < -90 || lat > 90 || lon < -180 || lon > 180) throw new HttpError(400, "lat_lon_invalid");
  u.lat = lat;
  u.lon = lon;
  u.locationUpdatedAt = nowMs();
  placeDemos(db, lat, lon);
  return [200, { user: meDto(u) }];
}

function livePhoto(u, body) {
  const dataUrl = body.image || "";
  const captured = Number(body.capturedAt || nowMs());
  const m = String(dataUrl).match(/^data:image\/(jpeg|jpg|png|webp);base64,(.+)$/i);
  if (!m) throw new HttpError(400, "image_required");
  const rawLen = Math.floor((m[2].replace(/\s/g, "").length * 3) / 4);
  if (!rawLen || rawLen > MAX_PHOTO_BYTES) throw new HttpError(400, "image_size");
  const pid = newId("ph");
  const url = dataUrl;
  u.livePhotos = u.livePhotos || {};
  u.livePhotos[pid] = { url, capturedAt: captured };
  u.lastPhoto = url;
  u.photos = (u.photos || []).concat(url).slice(-12);
  return [200, { photoId: pid, url, capturedAt: captured, user: meDto(u) }];
}

function nearby(db, u) {
  if (u.lat == null) throw new HttpError(400, "location_required");
  placeDemos(db, u.lat, u.lon);
  const people = [];
  for (const other of db.users) {
    if (other.id === u.id || other.lat == null) continue;
    const [ok] = withinMiles(u, other.lat, other.lon, 50);
    if (!ok) continue;
    if (nowMs() - (other.locationUpdatedAt || 0) > ACTIVITY_TTL_MS) continue;
    people.push(publicUser(other, u));
  }
  people.sort((a, b) => (a.miles ?? 999) - (b.miles ?? 999));
  const feedRadius = meetupRadius(u);
  const meetups = [];
  for (const req of db.requests) {
    maybeDemoRespond(db, req);
    if (req.status !== "open" || req.lat == null) continue;
    const [ok] = withinMiles(u, req.lat, req.lon, feedRadius);
    if (!ok) continue;
    const owner = userById(db, req.userId);
    if (owner && !prefsMatch(u, owner) && req.userId !== u.id) continue;
    meetups.push(serializeRequest(db, req, u));
  }
  return [200, { me: publicUser(u, u), radiusMiles: 50, feedRadiusMiles: feedRadius, people, meetups }];
}

function createMeetup(db, u, body) {
  if (u.lat == null) throw new HttpError(400, "location_required");
  if (!livePhotoOk(u, body.photoId)) throw new HttpError(400, "live_photo_required");
  if (!INTENTS.includes(body.intent) || !KINDS.includes(body.kind)) throw new HttpError(400, "offer_ask_invalid");
  const paid = (u.plan || "free") === "paid";
  let exp = nowMs() + FREE_EXPIRE_MS;
  if (paid && body.expireMinutes != null) {
    const mins = Math.max(1, Math.min(7 * 24 * 60, Number(body.expireMinutes)));
    exp = nowMs() + mins * 60 * 1000;
  }
  const live = u.livePhotos[body.photoId];
  const req = {
    id: newId("req"),
    userId: u.id,
    intent: body.intent,
    kind: body.kind,
    note: String(body.note || "").trim().slice(0, 280),
    livePhoto: live.url,
    photoId: body.photoId,
    lat: u.lat,
    lon: u.lon,
    status: "open",
    offerExpiresAt: exp,
    createdAt: nowMs(),
    channelId: null,
    demoResponded: false,
  };
  db.requests.push(req);
  return [200, { meetup: serializeRequest(db, req, u) }];
}

function listMeetups(db, u) {
  const mine = db.requests.filter((r) => r.userId === u.id).map((r) => serializeRequest(db, r, u));
  mine.sort((a, b) => b.createdAt - a.createdAt);
  return [200, { meetups: mine }];
}

function getMeetup(db, u, mid) {
  const req = db.requests.find((r) => r.id === mid);
  if (!req) throw new HttpError(404, "not_found");
  maybeDemoRespond(db, req);
  return [200, { meetup: serializeRequest(db, req, u) }];
}

function respond(db, u, mid, body) {
  const req = db.requests.find((r) => r.id === mid);
  if (!req) throw new HttpError(404, "not_found");
  if (req.status !== "open") throw new HttpError(400, "request_closed");
  if (req.userId === u.id) throw new HttpError(400, "cannot_respond_own");
  if (!livePhotoOk(u, body.photoId)) throw new HttpError(400, "live_photo_required");
  if (db.responds.some((r) => r.requestId === req.id && r.userId === u.id && r.status === "pending")) throw new HttpError(400, "already_responded");
  const paid = (u.plan || "free") === "paid";
  const live = u.livePhotos[body.photoId];
  const rsp = {
    id: newId("rsp"),
    requestId: req.id,
    userId: u.id,
    livePhoto: live.url,
    note: String(body.note || "").trim().slice(0, 280),
    status: "pending",
    expiresAt: paid ? null : nowMs() + FREE_EXPIRE_MS,
    createdAt: nowMs(),
  };
  db.responds.push(rsp);
  return [200, { respond: serializeRespond(db, rsp, u), meetup: serializeRequest(db, req, u) }];
}

function concur(db, u, mid, body) {
  const req = db.requests.find((r) => r.id === mid);
  if (!req) throw new HttpError(404, "not_found");
  if (req.userId !== u.id) throw new HttpError(403, "initiator_only");
  if (req.status !== "open") throw new HttpError(400, "request_closed");
  const rsp = db.responds.find((r) => r.id === body.respondId && r.requestId === mid);
  if (!rsp) throw new HttpError(404, "not_found");
  if (rsp.status !== "pending" || expired(rsp.expiresAt)) throw new HttpError(400, "respond_expired");
  const chId = newId("ch");
  db.channels.push({ id: chId, requestId: mid, userIds: [req.userId, rsp.userId], createdAt: nowMs() });
  req.status = "matched";
  req.channelId = chId;
  rsp.status = "concurred";
  for (const other of db.responds) {
    if (other.requestId === mid && other.id !== rsp.id && other.status === "pending") other.status = "closed";
  }
  db.messages.push({ id: newId("msg"), channelId: chId, userId: u.id, text: "Channel open. Text only from here.", createdAt: nowMs(), system: true });
  return [200, { channelId: chId, meetup: serializeRequest(db, req, u) }];
}

function inbox(db, u) {
  const incoming = [];
  const outgoing = [];
  const channels = [];
  for (const req of db.requests) {
    maybeDemoRespond(db, req);
    if (req.userId === u.id) incoming.push(serializeRequest(db, req, u));
  }
  for (const rsp of db.responds) {
    if (rsp.userId !== u.id) continue;
    const req = db.requests.find((r) => r.id === rsp.requestId);
    if (req) outgoing.push({ respond: serializeRespond(db, rsp, u), meetup: serializeRequest(db, req, u) });
  }
  for (const ch of db.channels) {
    if (!ch.userIds.includes(u.id)) continue;
    const otherId = ch.userIds.find((i) => i !== u.id);
    const other = userById(db, otherId);
    const last = [...db.messages].reverse().find((m) => m.channelId === ch.id);
    channels.push({ id: ch.id, requestId: ch.requestId, other: other ? publicUser(other, u) : null, createdAt: ch.createdAt, lastText: (last && last.text) || "" });
  }
  return [200, { incoming, outgoing, channels }];
}

function requireChannel(db, u, cid) {
  const ch = db.channels.find((c) => c.id === cid);
  if (!ch) throw new HttpError(404, "not_found");
  if (!ch.userIds.includes(u.id)) throw new HttpError(403, "not_member");
  return ch;
}

function listMessages(db, u, cid) {
  const ch = requireChannel(db, u, cid);
  const msgs = db.messages
    .filter((m) => m.channelId === cid)
    .map((m) => ({ id: m.id, text: m.text, createdAt: m.createdAt, system: !!m.system, isMine: m.userId === u.id, userId: m.userId }));
  const otherId = ch.userIds.find((i) => i !== u.id);
  const other = userById(db, otherId);
  return [200, { channelId: cid, other: other ? publicUser(other, u) : null, messages: msgs }];
}

function postMessage(db, u, cid, body) {
  requireChannel(db, u, cid);
  const text = String(body.text || "").trim();
  if (!text) throw new HttpError(400, "text_required");
  if (text.length > 1000) throw new HttpError(400, "text_too_long");
  const msg = { id: newId("msg"), channelId: cid, userId: u.id, text, createdAt: nowMs(), system: false };
  db.messages.push(msg);
  const ch = db.channels.find((c) => c.id === cid);
  let reply = null;
  if (ch) {
    const otherId = ch.userIds.find((i) => i !== u.id);
    const other = userById(db, otherId);
    if (other && other.demo) {
      reply = { id: newId("msg"), channelId: cid, userId: other.id, text: "On my way — see you there.", createdAt: nowMs() + 400, system: false };
      db.messages.push(reply);
    }
  }
  const payload = { message: { id: msg.id, text: msg.text, createdAt: msg.createdAt, system: false, isMine: true, userId: u.id } };
  if (reply) payload.reply = { id: reply.id, text: reply.text, createdAt: reply.createdAt, system: false, isMine: false, userId: reply.userId };
  return [200, payload];
}

export default {
  async fetch(request, env) {
    return handle(request, env);
  },
};
