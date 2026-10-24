# Tournament Builder — Foundation Build 0.1

A mobile-friendly React + TypeScript tournament management starter. Designed for volleyball, with a generic sport preset and dedicated Cloudflare Workers hosting. Backend: Supabase.

## What's working now

- Organizer dashboard, create / publish / delete tournament
- Add 2–64 teams (one name per line)
- Seeded snake or random assignment into evenly sized pools
- Full round-robin matchup generation, even for uneven / odd pool sizes
- One or two **fixed** sets per matchup; a 1–1 split is valid
- Score validation, saving and automatic set-based standings
- Public results links when Supabase is configured and a tournament is published
- Gold and Silver format choices stored and displayed as **provisional** division placements
- Responsive design for mobile and desktop
- Local **demo mode** (browser storage) to try the UI before connecting Supabase
- SQL schema with row-level security and atomic score submission
- Engine unit tests

## Not implemented yet

**Do not use this foundation build to administer a real tournament with playoffs.** The Gold/Silver bracket engine, advance-by-winner/loser, tie resolution overrides, explicit forfeits and withdrawals, manually edited assignments, court scheduling, audit history, scorekeeper permissions, and official qualification finalization are future milestones. Standings are live/provisional and the tiebreaker rules are currently fixed. A two-set pool matchup is **not** a double round robin.

## Run locally (Mac / Windows)

1. Install Node.js 22 or newer, Git and VS Code.
2. Unzip the project into its own folder, separate from any existing website.
3. Open that folder in VS Code, then open **Terminal → New Terminal**.
4. Run:

```bash
npm install
npm run dev
```

5. Open the local URL shown in the terminal (usually `http://localhost:5173`). Without environment variables, it starts in **Demo mode**, where data is stored **only in this browser**.
6. Run automated tests: `npm test`.

## Connect a **new** Supabase project (don't reuse the COS Volleyball database)

1. Supabase dashboard → **New project**. Supabase Free has a limited number of active projects.
2. In the new project's **SQL Editor**, paste and execute `supabase/schema.sql`. The schema enables Row Level Security.
3. Copy `.env.example` to `.env.local` in VS Code.
4. Supabase → **Project Settings / Connect** → copy your Project URL and **publishable** API key to `.env.local`. If only the older `anon` key is available, that is also a browser-safe public key with proper RLS.
5. **Never** put a `service_role` or database password in `VITE_` variables, a source file or GitHub.
6. Enable **Google** login in Supabase Authentication → Providers. The provider needs a Google Cloud OAuth app; follow the official instructions: https://supabase.com/docs/guides/auth/social-login/auth-google .
7. Supabase Authentication → URL Configuration: add `http://localhost:5173` to allowed redirect URLs. Later add your actual Cloudflare URL. Set the Site URL appropriately for the environment in use.
8. Restart `npm run dev`. You should see a **Sign in with Google** control instead of Demo mode.

**Important:** If the app points to a Supabase project where the SQL hasn't been run or Google login isn't configured, database-backed actions and/or login will fail. Demo mode is enabled only when the two `VITE_` settings are absent. It doesn't silently fall back if a configured backend fails.

## GitHub — make a separate repository

GitHub → New repository → `tournament-builder` → create it **empty** (don't initialize it with a README, license or `.gitignore`). Then, in VS Code terminal inside the unzipped project:

```bash
git init
git branch -M main
git add .
git commit -m "Initial Tournament Builder foundation"
git remote add origin https://github.com/YOUR_GITHUB_USERNAME/tournament-builder.git
git push -u origin main
```

Replace the URL with your own repository URL. You can also use VS Code Source Control → **Publish to GitHub** without entering all these commands. Check `.env.local` stays ignored by Git.

## Cloudflare deployment (Workers with Static Assets)

Cloudflare dashboard → Workers & Pages → Create application → Connect GitHub → select `tournament-builder` repo → use the `main` branch. The `wrangler.jsonc` name is `tournament-builder`; **match it exactly** in Cloudflare. Build command: `npm run build`. Deploy command: `npx wrangler deploy` (the platform may pre-populate this). Use the free `*.workers.dev` address initially.

Add both `VITE_SUPABASE_URL` and `VITE_SUPABASE_PUBLISHABLE_KEY` in **Cloudflare build variables** so Vite can compile the public connection settings. These values are public identifiers, **not secrets**. Then add the actual `workers.dev` address to Supabase Auth's redirect allow list.

Cloudflare docs: https://developers.cloudflare.com/workers/framework-guides/web-apps/react/ and https://developers.cloudflare.com/workers/ci-cd/builds/

## Architecture

- `src/main.tsx` — UI and application flows
- `src/engine.ts` — pure tournament generation/scoring/standings logic
- `src/repository.ts` — Supabase and local demo persistence
- `src/types.ts` — data contract
- `src/engine.test.ts` — deterministic engine tests
- `supabase/schema.sql` — normalized schema, RLS, score submission function
- `wrangler.jsonc` — Cloudflare Worker + SPA asset serving

Design decision: Gold/Silver format choices are saved as `playoff_divisions`, but playoff matches are intentionally not created yet. We will add the bracket data model and engine in a dedicated tested migration rather than pretend the placeholder is a functioning bracket.
