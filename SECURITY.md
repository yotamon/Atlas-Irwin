# Security Policy

## Supported versions

Security fixes are applied to the deployed production site at [https://atlasirwin.com](https://atlasirwin.com). This repository tracks that deployment.

## Reporting a vulnerability

Please **do not** open a public GitHub issue for security-sensitive reports.

Instead, contact the maintainer through the [Atlas Irwin website contact form](https://atlasirwin.com/#contact) with:

- A description of the issue and its impact
- Steps to reproduce
- Any proof-of-concept or supporting material

You should receive a response within a reasonable timeframe. We will coordinate disclosure and credit if you wish.

## Scope

In scope:

- The public website and `/api/*` routes
- Studio authentication and authorization at `/studio`
- Supabase RLS, storage access, and server-only credentials
- Third-party OAuth flows (SoundCloud, Spotify) configured for Studio

Out of scope:

- Social engineering or phishing against maintainers
- Denial-of-service against third-party services (Supabase, Vercel, MailerLite, etc.)
- Issues in dependencies with no available fix — report upstream and notify us

## Security practices in this repo

- Secrets belong in environment variables only (`.env.local` locally, Vercel/host env in production). Never commit `.env*` files except `.env.example`.
- `SUPABASE_SERVICE_ROLE_KEY`, OAuth client secrets, SMTP passwords, and Studio passwords are server-only.
- Studio is blocked from search indexing and uses separate cache/security headers.
- API routes for contact and newsletter use rate limiting and honeypot fields.
- Production enforces HTTPS redirect and security headers via `next.config.ts` and `proxy.ts`.

## If you cloned this repo

1. Rotate any credentials that may have been exposed before this repository was sanitized.
2. Copy `.env.example` to `.env.local` and supply your own Supabase project and integration keys.
3. Do not reuse production passwords or service-role keys from documentation examples.
