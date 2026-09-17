# Meet50 — development plan (updated)

Working title: **Meet50**. Public name still an admin pick (`ADMIN-DECISION.md`).

**Architecture (locked)**

1. **Now — web MVP for testing:** GitHub Pages (frontend) + Cloudflare Worker + KV (backend/DB).  
2. **After all nine functions work on the web MVP:** native **iOS** app for the **App Store**, talking to the **same Cloudflare API**. Not CloudKit. Not a second product.

```
                    ┌─────────────────────────┐
  Testers / web     │ GitHub Pages (UI)       │  https://dvpwemake.github.io/alvachat/
                    └───────────┬─────────────┘
                                │ HTTPS /api
                    ┌───────────▼─────────────┐
  One source of     │ Cloudflare Worker       │  workers.dev (free)
  truth             │ + KV database           │
                    └───────────┬─────────────┘
                                │ same /api
                    ┌───────────▼─────────────┐
  Later             │ Native iOS (Swift)      │  App Store
                    └─────────────────────────┘
```

GitHub cannot run a server. Do not wrap CloudKit in the website. Do not build iOS until the web MVP is signed off.

---

## Shared product (both clients)

Request → respond → initiator concurs → channel. Chat locked until the channel exists. Not swipe cards.

| # | Function | Web MVP | iOS later |
|---|---------|---------|-----------|
| 1 | Signup profile (name, age, gender, home city, job, marital, bio, looking for, filter) | In UI | Same API |
| 2 | Free: looking-for only. Paid: age, distance, education, time | Feed selectors | Same rules |
| 3 | Live camera to post/respond; becomes last profile photo; no gallery | `getUserMedia` | AVFoundation |
| 4 | Free / paid | Demo unlock until Stripe | StoreKit → same `plan` on API |
| 5 | Request → respond → concur → channel; free respond 30 min; paid does not expire | Worker-authoritative | Same |
| 6 | Text chat only after channel | Poll 2.5s | Same API + APNs |
| 7 | Own location + active users within 50 miles | Map + list | MapKit + same query |
| 8 | Offer or ask drink/meal | On request | Same |
| 9 | Free offer 30 min (minutes); paid sets expiry | Worker | Same |

One database. iOS does not get a parallel CloudKit schema.

---

## Phase 1 — web MVP (testing)

**Frontend:** this repo on GitHub Pages.  
**Backend:** `worker/` (Cloudflare Worker + KV).  
**Local:** `python app.py` on http://127.0.0.1:5055 with `MEET50_API` empty.

### 1A — Host the API (in progress)

1. Cloudflare free account, verify email.  
2. `npx wrangler login` **or** API token (`Edit Cloudflare Workers`).  
3. KV namespace `MEET50` — **done** (`843f02191f204817b66e6e03fa278463`).  
4. `npx wrangler deploy` — **blocked** until Workers email/token is accepted (`error 10034`).  
5. Paste Worker URL into `static/config.js` as `window.MEET50_API`.  
6. Push; hard-refresh https://dvpwemake.github.io/alvachat/

Until step 4–5, github.io uses **localStorage only** (this browser). Local Python still has a real JSON DB.

### 1B — Test the nine functions on the live web app

Gate for Phase 2: admin signs off that all nine work against Cloudflare KV, not only localhost.

- Signup lands on Me with every field filled.  
- Profile save survives refresh and another browser.  
- Home: all active users on map **and** list.  
- Feed: free vs paid selectors; expiry in **minutes**.  
- Camera required on post/respond.  
- Request → demo or second user respond → concur → chat.  
- 50-mile fence; users outside do not appear.  
- Paid is still a **demo** toggle — do not ship that to production.

### 1C — Production gaps (web, after test sign-off)

| Item | MVP now | After test |
|------|---------|------------|
| Paid | Demo button | Stripe (web) |
| Chat | Poll | Web Push |
| Photos | Data URL in KV | R2 if size bites |
| Auth | Bearer token | Email or Sign in with Apple |
| KV writes | 1,000/day, 1 write/sec on one key | Split keys or D1 if traffic grows |

Free Cloudflare cap (reset 00:00 UTC): 100k Worker requests/day, 100k KV reads/day, **1,000 KV writes/day**. Writes run out first.

---

## Phase 2 — native iOS (App Store)

Start **only** after Phase 1B is approved.

iOS is a **client of the same Worker**. Swift / SwiftUI + UIKit where needed. Camera: AVFoundation (stronger gate than the browser). Map: MapKit. Paid: StoreKit receipt sent to the Worker; Worker sets `plan`. Chat: same REST (then APNs).

### iOS sequence

1. Xcode app, Apple Developer Program, point at `MEET50_API`.  
2. Sign in / signup against `/api/signup` (Sign in with Apple later).  
3. Profile + filter screens (parity with Me).  
4. Location heartbeat → `/api/me/location`; map + list from `/api/nearby`.  
5. Live camera post/respond → `/api/photos/live` + meetups.  
6. Inbox, concur, channel chat.  
7. StoreKit → Worker paid flag.  
8. TestFlight → App Store (camera, location, IAP review notes).

Do not implement CloudKit. Do not ship a Capacitor wrap unless admin later asks for a third client.

---

## What not to do

- Two backends (KV + CloudKit).  
- iOS work before the web MVP is signed off.  
- Shipping the demo “Unlock paid” button.  
- Treating GitHub Pages as a server.

---

## Status snapshot (2026-09-16)

| Item | State |
|------|--------|
| Nine functions on local Python | Built |
| GitHub Pages UI | Live at `/alvachat/` |
| Cloudflare KV namespace | Created |
| Worker deploy | Waiting on verified Workers access + `wrangler deploy` |
| `config.js` API URL | Empty until deploy URL exists |
| Public product name | Not chosen |
| Native iOS | **Not started** (Phase 2) |
