# AlvaChat / Meet50 web app

UI (GitHub Pages, free GitHub domain): https://dvpwemake.github.io/alvachat/

API (Cloudflare Worker + KV, free): see `BACKEND.md`. GitHub Pages cannot run a server.

## Run locally

```
python app.py
```

Open http://127.0.0.1:5055

No extra packages. Profile fields are the same for free and paid. Feed page holds counterparty filters (free: looking-for only; paid: age, distance, education, time). Home is map + active-user list. Chat unlocks after the initiator concurs.

See DEVELOPMENT-PLAN.md and ADMIN-DECISION.md.
