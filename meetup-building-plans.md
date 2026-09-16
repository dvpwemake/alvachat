# Meetup iOS app — three building plans

**Status:** plans only. No app binary, no server, no IAP, no store ship.  
**Wait:** stop here for admin decision (which plan, or hybrid).  
**Prior context (not this deliverable):** `match-pilot/` is a static + Google Form/Sheet pilot. Do not extend or replace it unless admin later chooses that path.

---

## Shared product (all plans must ship these)

Tinder-like here means **request → respond → initiator concurs → channel**. Not swipe cards. Chat is locked until the channel exists.

### 1. Signup profile
Fields: **name, age, gender, home city, job, marital status, bio, looking for, filter**.  
`filter` is the user’s saved meetup filter (what they will apply when browsing/posting). Age is numeric (the brief’s “ago” is treated as **age**).

### 2. Preference selectors (who they want to meet)
- **Free:** one selector only: **gender**.
- **Paid:** full selectors: **age, distance, time** (plus gender).

### 3. Real-time camera photo gate
User **must take a real-time photo from the phone camera** to **post** a meetup request **or respond** to one. That capture becomes the **last profile photo**. Library/gallery picks are rejected for this action.

### 4. Two user levels: free and paid
Entitlement gates preference selectors, respond expiry, and offer/ask expiry. Free is the default; paid is StoreKit (or equivalent) unlock.

### 5. Mutual selection / meetup channel
- Initiator **issues a meetup request** (visible to matching nearby users).
- Other users **respond**.
- **Free respond expires in 30 minutes.** **Paid respond does not expire.**
- Channel **only** after the **initiator concurs** the respond. One-sided respond is not a match.

### 6. Text chat
Tinder-like **text chat only after** the meetup channel is established. No pre-channel DMs.

### 7. Geofence (50 miles)
Show the user’s **own location** and **active users within 50 miles** radius. Map/list, live-enough presence.

### 8. Offer or ask
Initiator sets **offer** a drink/meal **to** the counterparty, **or ask** a drink/meal **from** them. Attached to the meetup request.

### 9. Offer/ask expiry
- **Free:** offer and ask expire in **30 minutes**.
- **Paid:** user **sets the expiration time** of their offer and ask.

---

# Plan 1 — Conventional architecture with server side

Native **iOS** client + **your** API + database + object store + push. This is the default production shape if admin wants reliability at 50 miles, expiry that fires when the phone is asleep, and chat that does not depend on iCloud accounts.

## Stack
| Layer | Choice |
|--------|--------|
| Client | Swift / SwiftUI, iOS 17+, Core Location, AVFoundation camera, MapKit, StoreKit 2 |
| API | HTTPS REST or gRPC (Node, Go, or Python). Auth: Sign in with Apple + session JWT |
| Data | Postgres (users, prefs, requests, responds, channels, chat, entitlements) |
| Files | S3-compatible for profile/live photos |
| Realtime | WebSocket or APNs + polling for chat and inbound responds |
| Jobs | Worker/cron: expire free responds at 30 minutes; expire free offer/ask at 30 minutes; expire paid offer/ask at user-chosen time |
| Geo | PostGIS or lat/lon + Haversine / geography index, query `ST_DWithin(..., 50 miles)` |

No dependency on the user’s iCloud account for matching. Paid flag is **server-authoritative** after StoreKit receipt/JWS verify.

## 1. Signup profile
`POST /me` after Sign in with Apple. Persist **name, age, gender, home city, job, marital status, bio, looking for, filter**. Validate age range, gender enum, city string. Profile photo slot 0..n; last slot reserved for camera-gated live photo (function 3).

## 2. Preference selectors
`GET/PUT /me/preferences`.  
**Free:** API accepts **gender** only; rejects age/distance/time with 403 `paid_required`.  
**Paid:** accept **age** (min/max), **distance** (up to 50 miles), **time** (window when they will meet). Server applies these when listing nearby requests.

## 3. Camera-gated post / respond
Client: `AVCaptureSession` still, front or back, **no Photos picker** on Post and Respond buttons. Upload JPEG to `/photos/live` with `capturedAt` and device attestation if later desired. Server stores URL and sets `profile.lastPhotoId`.  
`POST /meetups` (request) and `POST /meetups/:id/responds` **require** a fresh live photo id (e.g. captured within N seconds). That photo is displayed as the **last profile photo**.

## 4. Free vs paid
StoreKit 2 auto-renewing subscription (or one-time). Client sends transaction JWS; server verifies with Apple and writes `users.plan = free | paid`. All preference, expiry, and offer-duration rules read `plan` on the server so the client cannot spoof paid.

## 5. Request → respond → initiator concurs → channel
Tables: `meetup_requests`, `meetup_responds`, `meetup_channels`.  
Flow: initiator creates request (with offer/ask, live photo, location). Eligible users (prefs + 50-mile geofence + active) see it. They respond with their live photo.  
**Free respond `expires_at = now+30m`.** **Paid respond `expires_at = null` (does not expire).**  
Worker marks expired responds `expired`; initiator cannot concur them.  
`POST /meetups/:id/concur` (initiator only) creates **channel** and unlocks chat. Until concur, no channel.

## 6. Text chat after channel
`GET/POST /channels/:id/messages`. WebSocket fan-out. Reject messages if no channel or user not a member. Optional APNs for background.

## 7. Geofence 50 miles
Client: `CLLocationManager` when posting/browsing (When In Use). `PUT /me/location`.  
List: active users and open requests with `distance <= 50 miles`. Map: own pin + others. “Active” = location heartbeat within a TTL (e.g. 15–30 min). Server never returns users outside the radius.

## 8. Offer or ask
On create request: `intent = offer | ask`, `kind = drink | meal`. Stored on the request; shown to responders. Counterparty sees the offer/ask before responding.

## 9. Offer/ask expiry
**Free:** `offer_expires_at = now+30m` (not user-editable).  
**Paid:** client sends `offer_expires_at` of their choice (bounds: e.g. 15m–7d); server stores it.  
When expired, request leaves the nearby feed; outstanding free responds still follow the 30-minute respond rule independently.

## Build sequence (Plan 1)
1. Auth + profile CRUD (all signup fields).  
2. Location heartbeat + 50-mile query.  
3. Camera live photo upload + last profile photo.  
4. Meetup request + offer/ask.  
5. Respond + 30-minute free expiry job; paid no expiry.  
6. Initiator concur → channel.  
7. Channel text chat.  
8. StoreKit paid: unlock age/distance/time prefs + paid offer expiry picker.  
9. Map UI for own location and active users in radius.

## Cost / ops
Always-on server, DB, storage, APNs certs, Apple Developer. Highest fidelity for expiry while the app is killed, 50-mile queries, and chat.

## Risks
Camera anti-spoof is still weak (a second phone pointed at a still). Server can add freshness checks later; not in this plan’s non-goals (no ID vendor).

---

# Plan 2 — No server side (iOS / iCloud, no-cost routing)

**No app server you operate.** All data communication through **Apple no-cost options**: **CloudKit** (iCloud), **PushKit/APNs via CloudKit subscriptions**, **StoreKit**, **Core Location**, **AVFoundation**. Not Multipeer Connectivity for the 50-mile geofence (that API is nearby-only and **does not cover 50 miles**).

This is not “no computers”: iCloud is Apple’s. It is “no your backend.” Quota: CloudKit public DB free tier (Apple’s current public-database limits). Existing `match-pilot/` Google Form/Sheet is a different no-server path and is **not** this plan.

## Stack
| Layer | Choice |
|--------|--------|
| Client | Swift / SwiftUI, same device APIs as Plan 1 |
| Directory / records | CloudKit **Public** database: profiles, locations, requests, responds, channels, messages |
| Private | CloudKit **Private**: device keys, draft profile, StoreKit mirror |
| Files | `CKAsset` for live/profile photos |
| Paid | StoreKit 2 on-device; write `plan` onto the user’s public `User` record (signed payload stored as Data; other devices treat as hint, client re-checks StoreKit locally) |
| Realtime | `CKQuerySubscription` + silent push for new responds, concurring, chat |
| Expiry | **On-device** timers when app is running; **CloudKit record `expiresAt`** so other phones hide expired rows even if the poster is asleep. No server cron: each client filters `expiresAt > now` on fetch. Optionally a local `BGAppRefreshTask` to delete own expired records |

## 1. Signup profile
Sign in with Apple **or** iCloud account (CloudKit requires iCloud). Create `User` record: **name, age, gender, home city, job, marital status, bio, looking for, filter**. Photos as `CKAsset` list; last asset is the live camera photo.

## 2. Preference selectors
`Preferences` record on the user. UI: **Free → gender only.** **Paid → age, distance, time** (and gender). Enforcement: Swift gates the extra pickers on `plan == paid`. Nearby fetch applies age/distance/time only if paid; free queries ignore those fields.

## 3. Camera-gated post / respond
Same AVFoundation live capture as Plan 1. Save to `CKAsset`, set `User.lastPhoto`. `MeetupRequest` and `MeetupRespond` records **must** reference a `livePhoto` asset with `capturedAt`. No Photo library picker on those actions. Display last photo on the public profile.

## 4. Free vs paid
StoreKit 2. Current entitlement on device drives UI. Mirror `plan` to CloudKit so others can see paid vs free expiry rules on that user’s responds/offers. Without a server, a determined user can tamper the mirrored field; the **honest client** still obeys StoreKit. Admin must accept this if choosing Plan 2.

## 5. Request → respond → initiator concurs → channel
Records: `MeetupRequest`, `MeetupRespond`, `MeetupChannel`.  
Initiator saves a request (location, offer/ask, live photo). Others query public DB. They save a respond.  
**Free respond expires in 30 minutes** (`expiresAt = now+30m`). **Paid respond does not expire** (`expiresAt` empty).  
Clients drop responds where `expiresAt < now`. Initiator **concur** writes `MeetupChannel` with both user refs. No channel record → no chat.

## 6. Text chat after channel
`ChatMessage` records keyed by `channelId`. Query subscription for the channel. If no `MeetupChannel` for the pair, the composer is disabled. iCloud push delivers new messages when the app is backgrounded (CloudKit subscription), not a chat server.

## 7. Geofence 50 miles
Core Location publishes `UserLocation` (lat, lon, `updatedAt`). CloudKit does not give a full PostGIS radius join. **Keep the 50-mile requirement:** store coordinates; query a **bounding box** (~50 miles in degrees) then **Haversine-filter to 50 miles** on device. Show own location on MapKit plus filtered active users (`updatedAt` within activity TTL). Multipeer / AirDrop / nearby are **out of scope** for this radius.

## 8. Offer or ask
On `MeetupRequest`: `intent` offer|ask, `kind` drink|meal. Shown on the request card before respond.

## 9. Offer/ask expiry
**Free:** offer and ask expire in 30 minutes (`offerExpiresAt = now+30m`, UI locked).  
**Paid:** date-time picker writes `offerExpiresAt` of their choice.  
All clients hide requests with `offerExpiresAt < now`. Same pattern as responds: no server worker; record field + client filter (+ optional background refresh to delete own expired rows).

## Build sequence (Plan 2)
1. CloudKit schema + iCloud sign-in + profile fields.  
2. Location records + 50-mile box + Haversine filter + map.  
3. Camera CKAsset + last profile photo.  
4. Request + offer/ask fields.  
5. Respond with free 30-minute `expiresAt` vs paid no expiry.  
6. Concur → `MeetupChannel`.  
7. Channel-only `ChatMessage`.  
8. StoreKit paid unlock for age/distance/time and paid offer expiry picker.

## Cost / ops
Apple Developer Program only (already required for camera/location/IAP). No VPS. Limits: CloudKit quotas, iCloud-required users, weaker paid enforcement, expiry not guaranteed to delete until some client reads the record.

## Risks (do not drop requirements)
- 50-mile geofence is **client-filtered**, not a server geo index.  
- 30-minute expiry is **field + filter**, not a job that fires at T+30 if nobody is online (records linger until a fetch).  
- Live photo anti-spoof is weaker than Plan 1 (no server attestation). Still required.

---

# Plan 3 — Web app wrapping vs native iOS

This is a **client-packaging** choice. It can sit on Plan 1’s server **or** (poorly) on Plan 2’s CloudKit. Two options:

**A. Native iOS** — SwiftUI, as in Plans 1–2.  
**B. Web app wrapping** — product is a responsive web app (PWA) inside **WKWebView** / **Capacitor** / **WKWebView shell**, shipped to the App Store as an iOS binary.

Both must still implement the same nine functions. Wrapping does **not** remove the camera gate, 50-mile geofence, expiry rules, or initiator-concur channel.

## How each function is built

| Function | Native iOS | Web wrap (WKWebView / Capacitor) |
|----------|------------|-----------------------------------|
| **1. Signup profile** (name, age, gender, home city, job, marital status, bio, looking for, filter) | SwiftUI forms, Keychain session | HTML forms; cookies/JWT. Same fields. |
| **2. Preference selectors** free = **gender** only; paid = **age, distance, time** | Native pickers gated on StoreKit | Web pickers gated on same entitlement API. Extra work to feel native. |
| **3. Real-time camera photo** as **last profile photo** to post or respond | AVFoundation; reject UIImagePicker gallery for this action | `getUserMedia` **or** Capacitor Camera with `source: Camera`. Must **force camera**, not file input / gallery. WKWebView camera permission + `NSCameraUsageDescription`. Freshness is easier to cheat in a browser. |
| **4. Free vs paid** | StoreKit 2 | StoreKit **still required** for IAP inside an App Store binary (Apple: digital goods). Web Stripe-only inside a wrapped app is a review risk. Native IAP plugin (Capacitor Purchases) + server verify if Plan 1. |
| **5. Request → respond → initiator concurs → channel**; free respond **30 minutes**, paid respond **does not expire** | Native lists + server or CloudKit | Same API as Plan 1 (recommended) or JS CloudKit (awkward). Expiry is server jobs (Plan 1) or record filters (Plan 2). UI is cards/lists, not swipe. |
| **6. Text chat after channel** | Native chat UI + WS/CloudKit | Web chat (WebSocket). WKWebView backgrounding is worse; need APNs via a small native plugin. |
| **7. Geofence 50 miles**, own location + active users | Core Location + MapKit | Browser Geolocation **or** Capacitor Geolocation; Mapbox/MapKit JS. Background location in a wrap is weaker. Still filter **50 miles**. |
| **8. Offer or ask** drink/meal | Native enum on request | Same fields in web form on create request. |
| **9. Offer/ask expiry** free **30 minutes**; paid **sets expiration** | Native DatePicker for paid | `<input type=datetime-local>` for paid; free locked to 30 minutes. |

## Wrapping stack (if admin picks B)
- **UI:** React or Vue PWA.  
- **Shell:** Capacitor iOS (camera, geolocation, push, IAP plugins) or a thin WKWebView app.  
- **Backend:** **Plan 1 server** (strongly preferred). CloudKit from JavaScript is possible (`cloudkit.js`) but a poor fit for a wrapped store app.  
- **Not sufficient:** a GitHub Pages static site like `match-pilot/` (no live camera gate, no 50-mile presence, no 30-minute expiry, no chat).

## Native vs wrap — decision notes
| | Native | Web wrap |
|--|--------|----------|
| Camera gate | Strongest (AVFoundation, no gallery) | Easy to get wrong (file picker). Doable if camera-only plugin is locked. |
| 50-mile geofence | Core Location + MapKit | OK in foreground; background/active-users heartbeat is worse. |
| Chat | Standard | Needs native push plugin or users miss responds. |
| Paid / IAP | StoreKit straightforward | Must still use IAP in-app; wrap adds a plugin and review surface. |
| Speed to first UI | Slower | Faster if web talent is the bench. |
| App Review | Normal | Extra scrutiny if it is “just a website.” Camera, location, IAP must be used in-app. |
| Plan 2 (no server) | CloudKit native SDK | Wrap + CloudKit is the worst pairing. Do not wrap Plan 2. |

## Recommendation (not a ship)
- If admin wants **no server**: **Plan 2 + native iOS**, not a wrap.  
- If admin wants **a real 50-mile product with expiry while the phone is asleep**: **Plan 1 + native iOS**.  
- Web wrap only if admin accepts Plan 1’s server **and** wants one web codebase; still ship Capacitor camera/IAP/location plugins and the same nine rules.

---

## Comparison (admin)

| | Plan 1 Server + native | Plan 2 iCloud native | Plan 3 wrap (on Plan 1) |
|--|------------------------|----------------------|-------------------------|
| Your server | Yes | No | Yes |
| 50-mile geo | Strong | Bounding box + device filter | Foreground OK |
| 30-min expiry | Worker job | Record field + client filter | Worker if Plan 1 |
| Paid enforcement | Server | StoreKit + honest client | Server + IAP plugin |
| Camera last photo | AVFoundation | AVFoundation | getUserMedia / plugin |
| Chat after concur | WS | CloudKit messages | WebSocket |
| Cost | Hosting | Apple developer only | Hosting + wrap |

---

## Explicit wait

**Sequence locked (2026-09-15):** web app first (`meetup-web/`). Plan 2 (native iCloud) starts only after admin approves the web app and picks a public name (`meetup-web/ADMIN-DECISION.md`).  
Do not start Plan 2, wrap, or a second backend until that approval.

No meetup iOS/Android app tree and no backend service were added for this goal.
