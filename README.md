# {{PRODUCT_NAME}}

[English](./README.md) · [中文](./README.zh-CN.md)

> AI review coach for World of Warcraft Mythic+ players who want to improve.
> Paste a Warcraft Logs report link or upload a `WoWCombatLog.txt`, pick a fight,
> and get a structured 6-chapter review — then ask questions about that specific run.

[![License](https://img.shields.io/github/license/{{OWNER}}/{{REPO}}?style=flat-square&label=License)](https://github.com/{{OWNER}}/{{REPO}}/blob/main/LICENSE)
[![Release](https://img.shields.io/github/v/release/{{OWNER}}/{{REPO}}?style=flat-square&label=Release)](https://github.com/{{OWNER}}/{{REPO}}/releases)
[![CI](https://img.shields.io/github/actions/workflow/status/{{OWNER}}/{{REPO}}/ci.yml?style=flat-square&label=CI&branch=main)](https://github.com/{{OWNER}}/{{REPO}}/actions/workflows/ci.yml)
[![Last commit](https://img.shields.io/github/last-commit/{{OWNER}}/{{REPO}}?style=flat-square)](https://github.com/{{OWNER}}/{{REPO}}/commits/main)
[![Stars](https://img.shields.io/github/stars/{{OWNER}}/{{REPO}}?style=flat-square)](https://github.com/{{OWNER}}/{{REPO}}/stargazers)
[![Dependabot](https://img.shields.io/badge/Dependabot-enabled-0366d6?style=flat-square&logo=dependabot)](https://github.com/{{OWNER}}/{{REPO}}/security/dependabot)

## What it is

`{{PRODUCT_NAME}}` is an AI review coach for Mythic+ players who already clear keys but
want to push further. You already have logs — this tool turns them into answers:

- **What did I actually do wrong** (with timestamps and spell evidence, not vague advice).
- **What looks like a mistake but was actually correct** — the tool understands *tactical intent*,
  so it won't scold you for holding your cooldown to line it up with a damage window.
- **What to practice next**, as 1–3 concrete drills.

It is built for the Chinese-speaking community first (UI and reports in Simplified Chinese),
and works with both global and CN Warcraft Logs.

## Features

- **Two ways to bring a log in**
  - Paste a Warcraft Logs report link (global `warcraftlogs.com` or CN `cn.warcraftlogs.com`).
  - Upload a `WoWCombatLog.txt` file. Parsing happens **entirely in your browser** — the raw
    file is never uploaded to any server.
- **6-chapter review report** (Simplified Chinese): overview → key moments → comparison with a
  top player → improvable points → tactical-intent explanations → next-step drills.
- **Tactical-intent understanding** — the core differentiator. "Looks wrong but was smart" is
  explained as a correct decision instead of being flagged as a mistake.
- **Community knowledge base (RAG)** — class/spec/dungeon knowledge is retrieved and injected so
  the AI can recognize intent that only domain knowledge explains.
- **Suspected advanced-technique discovery** — when evidence is solid but the knowledge base can't
  explain a move, it is reported as a *suspected technique* (with evidence) rather than a mistake.
- **Chat with the log** — ask questions about the run; answers cite real timestamps and spells.
- **One-click share** — publish a read-only link to a report; revoke it anytime.
- **Route fingerprint & comparison** — reconstruct tactical pulls from raw events and compare the
  route of two logs (similarity score + difference list), plus a comp profile.
- **Multi-log mining tool** — feed several logs from the same top player to surface techniques that
  repeat under similar conditions.
- **Accounts** — email code login (no password), daily free quota, saved history.

## Getting started (run it yourself)

Requirements: Node.js 24.

```bash
# 1. Install dependencies
npm ci

# 2. Configure environment (see .env.example for every variable)
cp .env.example .env.local

# 3. Start the dev server
npm run dev
```

Open http://localhost:3000.

> No keys yet? Fine — with all variables empty the app runs in **mock mode**: every external
> service falls back to a local mock, so you can try the full flow end to end. In mock mode the
> login code is printed to the server console (`[email:mock]`).

## Deploy

### Deploy to Vercel (one click)

[![Deploy with Vercel](https://vercel.com/button)](https://vercel.com/new/clone?repository-url=https://github.com/{{OWNER}}/{{REPO}})

After cloning, configure the environment variables listed in
[`.env.example`](./.env.example) in your Vercel project settings, then deploy.

### Environment variables

Every external service has its own key. All are optional for local development (empty = mock mode),
but **required in production** — the app refuses to silently fall back to mock mode when running
in production. See [`.env.example`](./.env.example) for the full, commented list:

| Variable | Purpose |
| --- | --- |
| `NEXT_PUBLIC_SUPABASE_URL` / `NEXT_PUBLIC_SUPABASE_ANON_KEY` / `SUPABASE_SERVICE_ROLE_KEY` | Supabase (auth + Postgres) |
| `RESEND_API_KEY` / `EMAIL_FROM` | Login-code email |
| `DEEPSEEK_API_KEY` / `DEEPSEEK_BASE_URL` / `DEEPSEEK_MODEL` | Report generation & chat |
| `WCL_CLIENT_ID` / `WCL_CLIENT_SECRET` | Warcraft Logs v2 API |
| `NEXT_PUBLIC_TURNSTILE_SITE_KEY` / `TURNSTILE_SECRET_KEY` | Cloudflare Turnstile (bot protection) |
| `EMBEDDING_API_KEY` / `EMBEDDING_BASE_URL` / `EMBEDDING_MODEL` | Knowledge-base embeddings |
| `APP_URL` | Public URL (must start with `https://` in production) |

## Privacy & compliance

- **Your raw log stays on your device.** When you upload a `WoWCombatLog.txt`, it is parsed locally
  in the browser; only the parsed, structured result is sent to the server. The original file is
  never uploaded.
- **No game credentials.** The tool never asks for, collects, or touches your game account password,
  and has no boosting / account-trading features.
- **You can delete your data.** Reports can be deleted from history, and you can request full account
  deletion.

### Disclaimer

**{{PRODUCT_NAME}} is not an official Blizzard product and is not affiliated with Blizzard
Entertainment.** World of Warcraft and related trademarks are the property of their respective
owners. This project is for personal learning and analysis only; it does not sell any in-game
content. See [`src/app/legal/disclaimer`](./src/app/legal/disclaimer/page.tsx) for the in-app
disclaimer.

## FAQ

**Is my log uploaded to your server?**
No. Uploaded `WoWCombatLog.txt` files are parsed in your browser; the raw file never leaves your
device. (Logs imported via a Warcraft Logs link are fetched server-side from Warcraft Logs.)

**Do I need an account?**
Yes, to generate reports and save history. It is a simple email-verification-code login with no
password. Each account gets a small free daily quota.

**Does it support raids?**
Not in v1. The first version focuses on Mythic+. Raid analysis is planned for a later version.

**Can I use it with the CN (China) server?**
Yes. It supports both `cn.warcraftlogs.com` links and local `WoWCombatLog.txt` uploads.

**Why does it sometimes say an odd move is correct?**
That is the tactical-intent engine. When a move looks wrong but has a plausible reason (e.g. holding
a cooldown to align with a damage window), it is explained as a correct decision instead of being
flagged as a mistake.

**Something broke / I found a bug.**
Please open an issue using the [bug report template](https://github.com/{{OWNER}}/{{REPO}}/issues/new?template=bug_report.md).

## Contributing

Contributions are welcome. See [CONTRIBUTING.md](./CONTRIBUTING.md) and
[CODE_OF_CONDUCT.md](./CODE_OF_CONDUCT.md). For security issues, follow
[SECURITY.md](./SECURITY.md).

## License

[MIT](./LICENSE) © 2026 {{AUTHOR}}
