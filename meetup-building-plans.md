# Meetup app — building plans

**Status (locked 2026-09-17):** two phases, one API.

1. **Web MVP (now):** GitHub Pages frontend + Cloudflare Worker + KV database. Test all nine functions here.  
2. **Native iOS (after MVP works):** App Store client of the **same** Cloudflare API. Not CloudKit. Not a wrap of the website.

**Repos:** `C:\GrokHub\Projects\alvachat` (canonical). Local Python twin: `meetup-web/`.  
**Working title:** Meet50. Public name: admin pick (`alvachat/ADMIN-DECISION.md`).  
**Detail plan:** `alvachat/DEVELOPMENT-PLAN.md`.  
**Do not start iOS until the web MVP is signed off.**

```
Testers     →  GitHub Pages UI     https://dvpwemake.github.io/alvachat/
                    │
                    ▼  HTTPS /api
               Cloudflare Worker + KV
                    ▲
                    │  same /api
App Store   →  Native iOS (Phase 2)
```

GitHub cannot run a server. Old Plan 2 (CloudKit, no your server) and Plan 3 (WKWebView wrap) are **not** the path. Plan 1’s *shape* (authoritative API) is kept; the free host is Cloudflare, not a VPS + Postgres.

---

## Shared product (web MVP and iOS must ship these)

Tinder-like here means **request → respond → initiator concurs → channel**. Not swipe cards. Chat is locked until the channel exists.

### 1. Signup profile
Fields: **name, age, gender, home city, job, marital status, education, bio, looking for, filter**.  
`looking for`: dropdown **Male / Female / LGBTQ**.  
`filter` (saved on profile, same for free and paid): **education, distance, age, looking for**.  
Age is numeric. Profile fields are **universal** (not gated by paid).

### 2. Preference selectors (who they want to meet)
Live on the **Feed**, not the profile. Used to filter counterparties.  
- **Free:** **looking for** only.  
- **Paid:** **age, distance (max 50 miles), education, time** (plus looking for).

### 3. Real-time camera photo gate
User **must take a real-time photo from the camera** to **post** a meetup request **or respond**. That capture becomes the **last profile photo**. Gallery/file picks are rejected.

### 4. Two user levels: free and paid
Entitlement gates Feed selectors, respond expiry, and offer/ask expiry. Free is default.  
**Money:** free stack only. The only paid item is **Apple Developer** (already paid). Web test: demo unlock (not real billing). iOS production: StoreKit → Worker sets `plan`. No Stripe, no paid Cloudflare, no paid maps/auth/push vendors. Worker is authoritative.

### 5. Mutual selection / meetup channel
- Initiator **issues a meetup request**.  
- Others **respond**.  
- **Free respond expires in 30 minutes.** **Paid respond does not expire.**  
- Channel **only** after the **initiator concurs**. One-sided respond is not a match.

### 6. Text chat
Text chat **only after** the channel exists. No pre-channel DMs.

### 7. Geofence (50 miles)
Own location + **all active users within 50 miles**. Map on top, list under it. Presence TTL ~30 min.

### 8. Offer or ask
Initiator sets **offer** or **ask** a **drink** or **meal** on the request.

### 9. Offer/ask expiry
- **Free:** 30 minutes (not editable).  
- **Paid:** user sets expiry in **minutes** (no seconds).

---

# Phase 1 — Web MVP (GitHub frontend + Cloudflare DB)

**Purpose:** test the nine functions with real persistence, without an App Store binary.

## Stack
| Layer | Choice |
|--------|--------|
| UI | Static SPA in `alvachat/` on **GitHub Pages** (`https://dvpwemake.github.io/alvachat/`) |
| API | **Cloudflare Worker** (`alvachat/worker/`) — same routes as local `app.py` |
| DB | **Workers KV** namespace `MEET50` (`id = 843f02191f204817b66e6e03fa278463`) |
| Local twin | `python app.py` → http://127.0.0.1:5055 (`MEET50_API` empty) |
| Auth | Bearer token (email / Sign in with Apple later) |
| Paid (test) | Demo unlock; do not ship |
| Camera | `getUserMedia`, no gallery |
| Map | Leaflet + Haversine ≤ 50 miles on the Worker |

Until the Worker is deployed, github.io falls back to **this-browser `localStorage`**. That is not the MVP. MVP = Worker URL in `static/config.js`.

## How each function is built (web)

| # | Function | Implementation |
|---|---------|----------------|
| 1 | Signup profile | `POST /api/signup`; Enter Meet50 opens **Me** with all fields |
| 2 | Feed selectors | `PUT /api/me/preferences`; free looking-for only |
| 3 | Camera gate | `POST /api/photos/live`; required on request/respond |
| 4 | Free / paid | `POST /api/me/plan`; Worker stores `plan` |
| 5 | Channel | request → respond → `POST .../concur` → channel |
| 6 | Chat | `GET/POST /api/channels/:id/messages`; poll 2.5s |
| 7 | 50 miles | `PUT /api/me/location`; `GET /api/nearby`; map + list |
| 8 | Offer/ask | `intent` + `kind` on `POST /api/meetups` |
| 9 | Expiry | free 30 min; paid `expireMinutes`; Worker filters on read |

## Phase 1 build sequence

1. Cloudflare free account, verify email, Wrangler login **or** API token.  
2. KV `MEET50` — **done**.  
3. `npx wrangler deploy` — **blocked** until Workers accepts the account (error 10034).  
4. Set `window.MEET50_API` in `static/config.js` to the `*.workers.dev` URL. Push.  
5. Test all nine functions on github.io (two browsers, not only localStorage).  
6. Admin sign-off → Phase 2.

## Free quotas (Cloudflare Workers Free, 00:00 UTC reset)

| | Limit |
|--|--------|
| Worker requests | 100,000 / day (1,000 / min) |
| KV reads | 100,000 / day |
| KV writes | **1,000 / day** (binding limit for this app) |
| Same-key writes | 1 / second |
| KV storage | 1 GB |

GitHub Pages: UI only (~100 GB bandwidth / month).

## Phase 1 risks
- Worker not live until email/token deploy succeeds.  
- Whole DB is one KV key (write cap + 1/sec). Split keys or D1 if testing traffic grows.  
- Browser camera is weaker than AVFoundation.  
- Demo paid is not a receipt.

---

# Phase 2 — Native iOS (App Store)

**Start only after Phase 1 sign-off.** Same nine functions, **same Worker**. No CloudKit schema.

## Stack
| Layer | Choice |
|--------|--------|
| Client | Swift / SwiftUI + UIKit where needed, iOS 17+ |
| API | Same Cloudflare Worker (`MEET50_API`) |
| Auth | Sign in with Apple → Worker session |
| Camera | AVFoundation; no Photos picker on post/respond |
| Map | MapKit; nearby list from `/api/nearby` |
| Paid | StoreKit 2; JWS to Worker; Worker sets `plan` |
| Push | APNs for inbound respond and chat |

## iOS build sequence

1. Xcode app, Apple Developer Program, point at Worker URL.  
2. Signup/profile against `/api/signup` and `/api/me`.  
3. Location heartbeat + map/list.  
4. Live camera post/respond.  
5. Request / respond / concur / chat.  
6. StoreKit → Worker paid.  
7. TestFlight, then App Store (camera, location, IAP review notes).

Do not implement CloudKit. Do not ship a Capacitor wrap unless admin later asks for a third client.

---

# Deferred (not the path)

Kept so the original three-plan memo is not lost. **Do not build these unless admin reverses the lock.**

**Old Plan 1** — own VPS + Postgres + object store + cron. Stronger than KV at scale. Use only if Cloudflare free caps are hit after launch.

**Old Plan 2** — native iOS + CloudKit, no your server. Not spec-complete (paid spoofable, expiry is hide-on-fetch, 50-mile is client-filter, iCloud required). Replaced by Phase 1 Worker + Phase 2 iOS client.

**Old Plan 3** — WKWebView / Capacitor wrap. Extra App Review risk. Camera/push/IAP weaker than native. Not Phase 2.

---

## Comparison (current lock)

| | Phase 1 Web MVP | Phase 2 Native iOS |
|--|-----------------|-------------------|
| When | Now | After 1B sign-off |
| UI | GitHub Pages | Swift App Store binary |
| Data | Cloudflare KV | **Same** KV via Worker |
| Camera | getUserMedia | AVFoundation |
| Paid | Demo unlock (test) | StoreKit → Worker |
| 50-mile / expiry | Worker | Worker |
| Cost | Free tiers | Apple Developer Program |

---

## Explicit wait

- **Now:** finish Worker deploy, wire `config.js`, test nine functions on github.io.  
- **Not now:** iOS Xcode project, CloudKit, wrap, any paid API.  
- **Name:** still admin pick; do not ship “Meet50” as the store name.
