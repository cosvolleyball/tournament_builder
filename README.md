# Tournament Builder

**Public beta · Tournament management for volleyball and similar sports**

**Live site:** https://cosvolleyball.github.io/tournament_builder/  
**Source repository:** https://github.com/cosvolleyball/tournament_builder  
**Default branch:** `master`

Tournament Builder lets an organizer create tournaments, run round-robin pool play, enter and correct scores, qualify teams for playoffs, and publish results for players and spectators. It is volleyball-first, but organizers can supply a different sport label. The frontend is a static React/TypeScript application hosted on GitHub Pages; **Supabase** provides authentication, the database, and server-side scoring / bracket logic.

> **Beta notice:** The site is live, but extensive real-world testing of every double-elimination bracket size and combination of custom divisions is still on the backlog. Test your chosen format before relying on it for an important event.

## What works

- **Public tournament directory:** Visitors can open the homepage while signed out and browse published tournaments. Drafts are excluded. Individual public tournament links use `?t=<tournament-id>`; division-specific links can include `&d=<division-id>`.
- **Organizer workspace:** Email/password login through Supabase Auth; organizers can create, publish, manage and delete their own tournaments. Currently, accounts are provisioned manually in Supabase rather than through public signup.
- **Custom competition divisions:** Each tournament can contain separately named divisions such as `Men's A`, `Women's BB`, `Coed Intermediate`, or any custom label. Divisions have independent teams, pools, standings, qualification and playoff brackets. Additional divisions are added while a tournament is a draft.
- **Pool play:** Round-robin matches, one or two sets per matchup, snake or random pool assignment, uneven pools, and per-pool scoring overrides. For two-set matches, a 1–1 split is valid and the standings account for sets individually.
- **Scoring rules:** Configurable target points, win-by-two and optional point cap. Pool-specific settings can inherit from division defaults or be overridden.
- **Playoff qualification:** Everyone, top finishers overall, or top X per pool plus next-place wildcards. A *no first-round byes* option helps select a full power-of-two bracket; organizers can review/edit playoff seed assignments before finalization.
- **Playoff brackets:** Single elimination and double elimination, with winners' and losers' sections, optional grand-final reset, and customizable bracket names (including Championship, Gold, Silver). Multiple playoff brackets may exist within a division.
- **Playoff match formats:** Single set, best-of-3, or best-of-5; round-specific scoring rules and separate deciding-set targets/caps.
- **Public score entry:** Visitors can submit scores to unfinished public pool and playoff matches without accounts. A completed match cannot be overwritten through the public entry flow.
- **Organizer corrections:** Owners can correct completed pool and playoff scores subject to server-side validation and downstream-match safeguards.
- **Tournament progress:** Overview cards reflect pool, playoff and championship completion; public viewers can follow scores, standings and brackets. Tournament pages refresh visible scores periodically.
- **Browser support:** Responsive interface, beta branding and favicon. Mobile bracket usability remains an active area for improvement.

### Not included yet

Public self-service organizer signup, player/team registration, payment processing, court scheduling, printed bracket/scoresheet export, multiple co-organizers per tournament, email notifications, and a full organizer audit trail are **not** implemented. Avoid assuming those capabilities are supported because a related table or placeholder exists.

## Tech stack and structure

| Location | Purpose |
| --- | --- |
| `src/main.tsx` | React UI, tournament creation, score forms, public pages and brackets |
| `src/repository.ts` | Supabase Auth/database/RPC adapter; local demo-storage fallback |
| `src/engine.ts` | Round robin, scoring validation and standings |
| `src/playoffs.ts` | Qualification, seeding, bye-free selection and bracket previews |
| `src/playoffFormats.ts` | Playoff match formats and set-series validation |
| `src/types.ts` | Shared TypeScript model |
| `src/*.test.ts` | Vitest regression tests |
| `src/style.css` | Responsive visual styles |
| `public/favicon.svg` | Site favicon |
| `vite.config.ts` | Vite configuration and GitHub Pages base path |
| `.github/workflows/` | GitHub Actions deployment (if present in the checkout) |
| `supabase/` | Database schema and incremental SQL migrations |

**Database concepts:** `tournaments` belong to an organizer's Auth user ID. `competition_divisions` are separate from `playoff_brackets`: a tournament can have multiple custom competition divisions, each with its own playoff bracket(s). Other tables include teams, pools, matches and set scores. PostgreSQL RLS and RPC functions—not hidden UI controls—must enforce organizer ownership and public write limitations.

## Run locally

Requires a current supported version of Node.js and npm. This project has used Node.js 24 for development and deployment.

```bash
npm ci
cp .env.example .env.local
# Edit .env.local with the existing Tournament Builder Supabase URL and public key.
npm run dev
```

Open the local URL reported by Vite (typically `http://localhost:5173/`).

```bash
npm run test
npm run build
npm run preview
```

- `npm run test` runs the Vitest suite.
- `npm run build` performs TypeScript checks and generates optimized files under `dist/`.
- `npm run preview` previews the production build locally.
- `npm ci` expects the project's existing `package-lock.json`. If working from a ZIP without one, use `npm install` once to create it.

The two environment variables are:

```dotenv
VITE_SUPABASE_URL=https://YOUR_PROJECT_REF.supabase.co
VITE_SUPABASE_PUBLISHABLE_KEY=YOUR_PUBLIC_PUBLISHABLE_OR_ANON_KEY
```

These values are **public client configuration**, not administrator secrets. Never put a Supabase `service_role` key, an `sb_secret_` key, or database credentials into any `VITE_` variable, frontend file or git commit. `.env.local` should stay ignored by Git.

If both variables are absent, the application enters a **browser-only demo mode** with local storage. Demo mode is not a substitute for the hosted backend and does not implement real shared public scoring or playoff finalization.

## Supabase setup

The deployed site uses a **dedicated Tournament Builder Supabase project**. It is not the database for the separate Colorado Springs Pickup Volleyball signup website.

1. Create/authenticate organizer users through **Supabase → Authentication → Users**. Public organizer self-signup is not currently available.
2. Configure **Authentication → URL Configuration** for the deployed GitHub Pages address and any local development redirect URLs you use.
3. Apply the database's foundational schema and **all applicable incremental migrations in version order** when setting up a *new* Supabase project. Existing installations must not blindly rerun foundation scripts or one-off hotfixes. Review the migration README/source and back up live data before modifying the schema.
4. Ensure the **v0.8c qualification** and **v0.9a custom-divisions** changes and the subsequent division-finalization hotfix are applied in installations that require them.
5. Verify anonymous RLS and RPC behavior against a real published tournament and an unpublished draft. Authenticated organizers must not be able to change other organizers' tournaments.

The original `supabase/schema.sql` is the **foundation schema**, not a complete representation of all v0.9+ features. Upgrades added server functions for score entry, playoff series, double elimination, custom divisions and bracket finalization. Treat migration history as part of the deployed system, not as optional frontend configuration.

**Important:** Organizer accounts are linked through `tournaments.owner_id`. Removing an organizer and deleting their tournaments is destructive. Back up data and verify the target Auth user before running removal SQL.

## GitHub Pages deployment

The live site is published at:

`https://cosvolleyball.github.io/tournament_builder/`

The repository is public, with `master` as the release branch. **Settings → Pages → Build and deployment → Source** is set to **GitHub Actions**.

The workflow should:

1. Check out `master` and set up Node.js.
2. Run `npm ci`, then `npm run test`.
3. Run `npm run build` with GitHub Actions repository variables `VITE_SUPABASE_URL` and `VITE_SUPABASE_PUBLISHABLE_KEY`.
4. Upload `dist/` using `actions/upload-pages-artifact` and deploy using `actions/deploy-pages`.

In `vite.config.ts`, the production base is `/tournament_builder/` and the development base is `/`. **Do not replace the project-path base with `/`**, or production JS/CSS references will break on GitHub Pages.

The old foundation `npm run deploy` script targets Cloudflare; it is **not** used for the current GitHub Pages release. Use the GitHub Actions workflow instead.

After a successful push, check the **Actions** tab for a passing build/deployment and test the public URL. If deployment fails, inspect the failed workflow step; simply running `npm run build` locally does not prove that GitHub has the required variables.

## Performance notes

The current optimization batch makes independent Supabase detail queries concurrent and separates React, Supabase, and icons into stable build chunks. Vite hashes production assets for browser caching. **Code splitting improves caching and can reduce load latency but does not necessarily reduce the total transferred JavaScript size.** Confirm results using the build report and browser Network/Performance tools; no production-speed benchmark is claimed here.

For high-traffic tournaments, keep an eye on Supabase API quotas, match-score request sizes, and query limits. Public tournament detail views refresh while visible, so the polling rate has backend implications.

## Beta validation and known limitations

Before using a format at a live tournament, verify at least:

- Organizer login, new tournament setup, publish and signed-out discovery.
- Each intended division's independent teams, pools, scores, standings and bracket finalization.
- Anonymous score submissions and the inability to overwrite completed results.
- Qualifier/wildcard ranking and the selected no-bye behavior.
- Winners'/losers' progression, byes, grand-final behavior and organizer corrections for the specific field size in use.
- Mobile presentation and the ability to refresh a public link without losing context.

**Deferred QA:** Exhaustive double-elimination combinations (especially unusual field sizes and resets), cross-pool wildcard fairness with unequal scoring settings, large-event performance, and broader mobile usability. This is an active public beta, not an audited tournament administration service.

## Roadmap

- Expand live beta regression coverage for double elimination, custom divisions, security and public scoring.
- Review wildcard fairness and tiebreaks across uneven pools.
- Continue mobile bracket polish and performance measurement.
- Add optional export/print support, organizer self-service accounts, public team registration, manual payment tracking and collaborator management later.

**Contributing / changes:** Open a focused GitHub issue or propose a small pull request, run `npm run test` and `npm run build`, and verify existing public features remain intact. Do not commit secrets or personal participant contact details.
