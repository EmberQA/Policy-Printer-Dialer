# Policy Printer Dialer

Browser softphone for Policy Printer agents — served at `dialer.policyprinter.io`
(localhost in dev). A **thin** WebRTC dialer + lead-capture surface:

- **Retreaver** owns routing/selection/balancing/recording.
- **Twilio** is only a WebRTC↔SIP bridge.
- The **EmberQA backend** owns auth, presence/availability, leads, dispositions,
  and provisioning. This app holds **no admin/config UI** — all of that lives on
  the main EmberQA app behind the PP-root tabs.

Stack (current as of June 2026): React 19 + Vite 8 + TypeScript 5.9 + Tailwind
CSS v4 (CSS-first, `@tailwindcss/vite`, no `tailwind.config.js`) + shadcn/ui
(new-york) + react-router 7. Light, neutral agent-workflow theme.

## Auth — there is no login here

Entry is always the main Policy Printer app's **Open Dialer** button. That mints a
single-use handoff code and opens `dialer.policyprinter.io/?code=<code>`. On boot
the dialer trades the code for a real EXTENSION JWT pair via the **unauthenticated**
`POST {VITE_DIALER_AUTH_BASE}/exchange`, stores it (localStorage), and uses it on
all `/api/v1` calls as `Authorization: <access>,<refresh>`. The backend rotates the
access token via a `newAccessToken` field in response bodies, which the axios layer
captures automatically.

A separate subdomain can't share the main app's host-only `sameSite:Strict`
cookies — hence the handoff rather than a shared cookie.

Key files:
- `src/auth/handoff.ts` — read `?code` → exchange → store → strip from URL
- `src/auth/session.ts` — token storage + rotation
- `src/lib/api.ts` — axios with the combined `Authorization` header + token rotation

## Develop

```sh
npm install
cp .env.example .env   # point VITE_API_BASE / VITE_DIALER_AUTH_BASE at your backend
npm run dev            # http://localhost:5174
npm run typecheck
```

To test the handoff in dev, mint a code from the running backend (authed as a
provisioned PP agent) and open `http://localhost:5174/?code=<code>`.

## Status

Subplan 01 (skeleton + handoff) is implemented: auto-login, the authed API layer,
the dialer profile round-trip, and `Dial` / `Leads` page stubs. Presence/heartbeat
(02), Twilio softphone (03), lead workflow (04), and the CRM (05) come next.

## Git remote (deferred)

This repo is initialized locally but is **not** yet pushed to a GitHub remote —
that's a coordination step with the repo owner (org, name, visibility). Create it,
then:

```sh
git remote add origin <url>
git push -u origin main
```
