# Meet50 web app vs Plan 2 — development plan

**Product:** the nine shared functions in `meetup-building-plans.md`.  
**Now (locked):** build and iterate the **web app** until admin approves it.  
**After approval:** Plan 2 (native iOS / CloudKit) is a **port of the approved web app** — same brand, same nine functions, same flows. Do not start Plan 2 before that.  
**Name:** working title Meet50. Public name is an admin pick — see `ADMIN-DECISION.md`.

This website is a **Plan-1-shaped backend with a web client**, which is the pairing Plan 3 already called the only serious web path. Wrapping Plan 2’s CloudKit in a website is the worst pairing in the original memo; do not do that.

---

## Verdict used by this plan

Plan 2 is **not spec-complete**. It can ship screens for all nine functions on an honest iPhone with iCloud, but it fails the specs wherever a rule must hold if the phone is off or the user tampers CloudKit.

This web prototype **is spec-complete for the nine functions on localhost**, with two production gaps called out below (real IAP/Stripe, and camera anti-spoof).

---

## Build what is already here (prototype — done)

Working on `http://127.0.0.1:5055`:

1. Signup profile (name, age, gender, home city, job, marital status, bio, looking for, filter)
2. Preference selectors — free = gender only; paid unlocks age, distance (≤50), time
3. Live camera gate via `getUserMedia` — no gallery on post/respond; capture becomes last profile photo
4. Free vs paid (demo entitlement; server-authoritative)
5. Request → respond → initiator concurs → channel; free respond 30 min; paid respond does not expire
6. Text chat only after channel
7. Own location + active users within 50 miles (Haversine, Map)
8. Offer or ask a drink/meal on the request
9. Free offer/ask 30 min; paid sets expiration

Demo users spawn around the first GPS fix so the map is not empty. A nearby demo typically responds ~10s after you post, so the concur → chat path is exercisable solo.

---

## Web production sequence (if admin picks the website)

| Phase | Work | Done in prototype? |
|------|------|---------------------|
| W1 | HTTPS host, persistent DB (Postgres), auth (email or Sign in with Apple) | Local JSON + bearer token |
| W2 | Location heartbeat + 50-mile query on the server | Yes (JSON + Haversine) |
| W3 | Camera capture only; store blobs; freshness window | Yes (10 min live-photo window) |
| W4 | Meetup request + offer/ask + expiry fields | Yes |
| W5 | Respond + server expiry on every read (add a worker so expiry does not wait for a fetch) | On-read yes; worker not yet |
| W6 | Concur → channel; reject chat without membership | Yes |
| W7 | Chat over WebSocket + push (web push / APNs if wrapped) | Polling 2.5s |
| W8 | Paid: **Stripe** on the open web; **StoreKit** if this site is later wrapped for the App Store | Demo toggle only |
| W9 | Map + presence TTL; hide users outside 50 miles | Yes |

Do not ship the demo “Unlock paid” button. That is a stand-in for a receipt.

---

## Plan 2 sequence (if admin picks native iCloud, no server)

Unchanged from the building-plans memo:

1. CloudKit schema + iCloud sign-in + profile  
2. Location records + bounding box + on-device Haversine + MapKit  
3. AVFoundation live `CKAsset`  
4. Request + offer/ask  
5. Respond `expiresAt` (free 30 min / paid empty)  
6. Concur → `MeetupChannel`  
7. Channel-only `ChatMessage`  
8. StoreKit unlock for age/distance/time and paid expiry picker  

Admin must accept: iCloud required, paid field spoofable, expiry is hide-on-fetch not a job, 50-mile is client-filtered.

---

## Comparison — Plan 2 vs this web app

| | Plan 2 (native iOS / iCloud, no your server) | Web app (this site + API) |
|--|-----------------------------------------------|---------------------------|
| **Deliverability** | **Not to spec.** All nine *screens* can be built. Paid is not enforceable. 30-minute expiry does not fire if no client reads. 50-mile fence is a bounding box + device filter. Users without iCloud are locked out. Camera gate is strong (AVFoundation). | **To spec on the nine functions**, with a server you operate. Paid and expiry and radius are authoritative. Camera gate is weaker (`getUserMedia`; a still held up to the lens still works). Production paid = Stripe (web) or StoreKit (if wrapped). **Not an iOS App Store app** unless later wrapped (Plan 3). |
| **Cost** | Apple Developer Program only. No VPS. Hits CloudKit public-DB quotas as the 50-mile directory grows. | Domain + HTTPS + small VM/DB + photo storage. Prototype is free on localhost. Production is more cash than Plan 2, far less than a large Plan 1 fleet. Stripe fees if paid is real. |
| **Stability** | Bound to iCloud status, CloudKit outages, silent-push delivery, and client clocks. Records linger after expiry. No job runner. | Bound to your process/DB. Expiry is evaluated on the server on every read. Prototype is a single JSON file (not HA). Production Postgres + worker is the stable shape. Browser tabs sleep; need web push for inbound responds. |
| **User experience** | Native feel, MapKit, reliable background location/push, App Store install. Forced iCloud. Chat when backgrounded depends on CloudKit subscriptions. | Fast to first UI, works on phone *and* desktop browsers. Camera and GPS need HTTPS + permission. Background presence and chat alerts are worse than native. No swipe (matches spec). Glanceable UI is doable; HMI-grade 70mph density is a native job. |

---

## Recommendation

- Need **no server** and will accept the spec gaps: Plan 2 native. Do not wrap it.  
- Need **the spec as written** (paid means paid, 30 minutes means 30 minutes, 50 miles means 50 miles): keep this web app’s server model, or Plan 1 + native iOS.  
- Need **one codebase and a website first**: continue this repo (W1–W8), then optionally wrap with Capacitor *on this API* (Plan 3B).  

Do not run Plan 2 and this website as two sources of truth.
