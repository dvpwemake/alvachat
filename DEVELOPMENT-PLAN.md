# Meet50 — development plan

Working title: **Meet50**. Public name: admin pick (`ADMIN-DECISION.md`).  
GGH copy: `grokdrive:GrokHub/Meet50/`. Public UI: https://dvpwemake.github.io/alvachat/

**Locked:** one Cloudflare API. Two clients in order.

1. **Phase 1 — web MVP** (GitHub Pages UI + Cloudflare Worker/KV DB) for testing.  
2. **Phase 2 — native iOS** App Store app on that **same** API. Not CloudKit. Not a website wrap.

```
Web testers  →  GitHub Pages          github.io/alvachat
                      │
                      ▼  /api
                Cloudflare Worker + KV
                      ▲
                      │  same /api
App Store    →  Native iOS (Phase 2)
```

Do not start Phase 2 until Phase 1 sign-off. Do not add a second database.

---

## Product (both phases)

Request → respond → initiator concurs → channel. Chat locked until the channel exists.

| # | Function | Web | iOS |
|---|---------|-----|-----|
| 1 | Signup profile | Form → Me | Same API |
| 2 | Free: looking-for only. Paid: age, distance, education, time | Feed | Same rules |
| 3 | Live camera post/respond; last profile photo; no gallery | getUserMedia | AVFoundation |
| 4 | Free / paid | Demo → Stripe | StoreKit → Worker `plan` |
| 5 | Channel; free respond 30 min; paid no expiry | Worker | Same |
| 6 | Text chat after channel | Poll | REST + APNs |
| 7 | Active users within 50 miles | Map + list | MapKit + same query |
| 8 | Offer or ask drink/meal | On request | Same |
| 9 | Free offer 30 min; paid sets minutes | Worker | Same |

---

# Phase 1 — Web app (GitHub UI + Cloudflare DB)

**Goal:** all nine functions work on github.io against KV, in two browsers, not only this machine.

Local twin: `python app.py` at http://127.0.0.1:5055 with `window.MEET50_API = ""`.

### Step 1.1 — Cloudflare account
- [x] Free account (`dvp@wemake.cloud`).  
- [ ] Dashboard shows **no** “verify email” banner (Workers still returns `10034` until this is accepted).  
- [x] Wrangler OAuth worked once; prefer **API token** (Edit Cloudflare Workers) if OAuth callback fails.

### Step 1.2 — Database
- [x] `npx wrangler kv namespace create MEET50`  
- [x] id `843f02191f204817b66e6e03fa278463` in `worker/wrangler.toml`

### Step 1.3 — Deploy API
- [ ] `$env:CLOUDFLARE_API_TOKEN = "..."` (in your terminal, not chat)  
- [ ] `cd C:\GrokHub\Projects\alvachat\worker`  
- [ ] `npx wrangler whoami`  
- [ ] `npx wrangler deploy`  
- [ ] Open `https://alvachat-api.<you>.workers.dev/api/health` → `{"ok":true}`

### Step 1.4 — Point the GitHub UI at the API
- [ ] Set `static/config.js`: `window.MEET50_API = "https://alvachat-api.<you>.workers.dev"`  
- [ ] Commit, `git push origin main`  
- [ ] `ggh.ps1 commit -Message "wire Worker URL"`  
- [ ] Hard-refresh https://dvpwemake.github.io/alvachat/

Until 1.3–1.4, github.io is **localStorage only**. That is not the MVP.

### Step 1.5 — Function test (two browsers / two devices)

Sign off each row on the **live** site (KV), not only localhost.

| Step | Test | Pass? |
|------|------|-------|
| 1.5.1 | Signup → lands on **Me** with every field filled | |
| 1.5.2 | Save profile; refresh; second browser sees the same user | |
| 1.5.3 | Home: **map + list** of all active users in 50 miles | |
| 1.5.4 | Feed: free = looking-for only; paid unlocks age/distance/education/time | |
| 1.5.5 | New request requires **live camera**; no gallery | |
| 1.5.6 | Offer/ask; free expiry 30 **minutes**; paid sets minutes | |
| 1.5.7 | Second user (or demo) responds with camera | |
| 1.5.8 | Initiator **concurs** → channel opens | |
| 1.5.9 | Chat works only after channel; outsider cannot read | |
| 1.5.10 | User far outside 50 miles does not appear | |

**Gate:** admin signs 1.5.1–1.5.10. Then Phase 2.

### Step 1.6 — After test (web, not required for iOS start)

| Item | After sign-off |
|------|----------------|
| Paid | Replace demo button with Stripe |
| Chat | Web Push (tabs sleep) |
| Photos | R2 if KV size hurts |
| Auth | Email or Sign in with Apple |
| KV | Split keys or D1 if writes hit 1,000/day |

Free cap (00:00 UTC): 100k Worker req/day, 100k KV reads/day, **1,000 KV writes/day**, 1 write/sec on the same key.

---

# Phase 2 — Native iOS (App Store)

**Start only after Phase 1.5 is signed.** Same Worker URL. No CloudKit.

### Step 2.1 — Apple setup
1. Apple Developer Program ($99/year).  
2. New Xcode app, iOS 17+, bundle id reserved.  
3. Capabilities: Camera, Location When In Use, Push, In-App Purchase.  
4. Config: `MEET50_API` = the Worker URL from 1.3.

### Step 2.2 — Auth and profile
1. Signup/login → `POST /api/signup`, `GET/PUT /api/me`.  
2. Sign in with Apple (store-friendly) mapped to the same user record.  
3. Me screen: same fields as web (looking-for dropdown, filter: education, distance, age).  
4. Profile fields not gated by paid.

### Step 2.3 — Map and presence
1. Core Location heartbeat → `PUT /api/me/location`.  
2. `GET /api/nearby` → MapKit pins + list under the map.  
3. 50-mile fence is the Worker’s; do not filter only on device.

### Step 2.4 — Feed and paid
1. Feed selectors: free looking-for; paid age/distance/education/time.  
2. StoreKit 2 purchase → send JWS to Worker → Worker sets `plan`.  
3. Never trust a client-only paid flag.

### Step 2.5 — Camera meetup flow
1. AVFoundation capture only (no Photos picker) on post and respond.  
2. `POST /api/photos/live` then `POST /api/meetups` / `.../responds`.  
3. Capture becomes last profile photo.  
4. Offer/ask + expiry minutes, same as web.

### Step 2.6 — Concur and chat
1. Inbox of responds; initiator concurs → `POST .../concur`.  
2. Chat `GET/POST /api/channels/:id/messages` only if member.  
3. APNs for inbound respond and new chat while backgrounded.

### Step 2.7 — Ship
1. Internal TestFlight: two devices, all nine functions against KV.  
2. Privacy nutrition labels: camera, location, photos, purchases.  
3. Review notes: why camera is required, why location, IAP.  
4. App Store submit.  
5. Do not ship demo paid.

---

## What not to do

- iOS before 1.5 sign-off.  
- CloudKit or a second DB.  
- Capacitor/WKWebView wrap unless admin asks later.  
- Treating GitHub Pages as a server.  
- Shipping the web demo “Unlock paid” button.

---

## Status (2026-09-17)

| Item | State |
|------|--------|
| Nine functions, local Python | Built |
| GitHub Pages UI | Live |
| KV namespace | Created |
| Worker deploy (1.3) | **Blocked** (`10034` / token) |
| `config.js` Worker URL (1.4) | Empty |
| Phase 1.5 live tests | Not started |
| Phase 2 iOS | **Not started** |
| Public name | Not chosen |
