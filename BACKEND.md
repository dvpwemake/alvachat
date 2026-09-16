# Real backend (free) + GitHub Pages domain

GitHub Pages **cannot** run Python or any server. The site at
https://dvpwemake.github.io/alvachat/ is static HTML/JS only.

This repo’s backend is a **Cloudflare Worker** (free) + **KV** (free key-value
database). Profiles, locations, requests, and chat are stored there — not in
`localStorage`.

```
Browser  →  GitHub Pages (UI)     https://dvpwemake.github.io/alvachat/
         →  Cloudflare Worker     https://alvachat-api.<you>.workers.dev
                └── KV "MEET50"   (the database)
```

`workers.dev` is Cloudflare’s free hostname (no domain purchase). GitHub’s
free hostname is `github.io`. You do **not** need a custom bought domain.

If you later buy a domain, point:

- apex / `www` → GitHub Pages
- `api.` → this Worker (Cloudflare dashboard → Workers → Custom domains)

## One-time setup (free Cloudflare account)

1. Sign up at https://dash.cloudflare.com/sign-up (free).
2. On your PC, in this repo:

```
cd worker
npx wrangler login
npx wrangler kv namespace create MEET50
```

3. Copy the printed **id** into `worker/wrangler.toml` replacing
   `REPLACE_WITH_KV_NAMESPACE_ID`.
4. Deploy:

```
npx wrangler deploy
```

Wrangler prints a URL like `https://alvachat-api.abc123.workers.dev`.

5. Paste that URL into `static/config.js`:

```
window.MEET50_API = "https://alvachat-api.abc123.workers.dev";
```

6. Commit and push. GitHub Pages will serve the new `config.js`. Hard-refresh
   the site. **Enter Meet50** now writes to KV, not only this browser.

## GitHub Actions (optional)

Repo **Settings → Secrets and variables → Actions**:

- `CLOUDFLARE_API_TOKEN` — token with Workers + KV edit
- `CLOUDFLARE_ACCOUNT_ID` — from the Cloudflare dashboard URL / Workers overview

Then every push to `worker/` deploys the API.

## Local

`python app.py` still uses the on-disk JSON API at `/api`. Leave
`window.MEET50_API = ""` so localhost talks to Python. Set it only for
github.io.
