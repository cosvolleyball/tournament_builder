# Tournament Builder — Backlog

_Last updated: November 15, 2026_

**Status:** Public beta; no currently confirmed release-blocking defect.  
**Live site:** https://cosvolleyball.github.io/tournament_builder/  
**Repository:** https://github.com/cosvolleyball/tournament_builder (branch: `master`)

This file is the source of truth for remaining work. When something is completed, update this file in the same change so a future conversation or contributor can pick up where we left off.

## Verification status

- [x] **Live Supabase database integration testing (November 15, 2026).** All 12 double-elimination scenarios passed: 5/8/14/16 teams, structural byes, lower-finalist wins with/without reset, undefeated champion, winner/loser routing, owner corrections, blocked downstream corrections, reset removal/recreation and independent custom divisions. Primary fixtures exercised 747 pool scores and 238 playoff matches. All fixtures rolled back.
- [x] **Live database authorization testing (November 15, 2026).** Actual `anon` / `authenticated` roles with two synthetic Auth identities verified draft privacy, organizer ownership isolation, public overwrite protection and restricted RPCs. An additional 91 permission/scoring checks passed, including all 11 tables, malformed inputs, pool overrides/caps and best-of-1/3/5 deciding sets. This tests database roles/claims, not actual organizer login sessions.
- [x] **Anonymous HTTP integration/concurrency (November 15, 2026).** Draft fixture hidden in seven populated application tables; draft scoring rejected. Racing two pool submissions and two playoff submissions each produced exactly one success and one rejection with the accepted score preserved. Disposable committed tournament and synthetic Auth identity deleted; cleanup verified.
- [x] **Live wildcard data parity (November 15, 2026).** 26 live RPC scores from 5/5/4 pools were read into the real frontend ranking functions; top two plus two third-place wildcards produced the expected eight qualifiers. Live bracket creation enforced zero first-round byes. Ranking is frontend-calculated; there is no separate SQL standings algorithm.
- [ ] **Authenticated HTTP/browser session verification.** Database owner isolation is verified, but actual A/B access tokens, login/refresh/logout/back-button behavior and organizer browser flows were not exercised. Requires disposable organizer sessions or a staging Auth environment; do not reset existing accounts or change existing tournaments to test this.

Reusable checks, exact scope, cleanup and security-advisor notes: [tests/integration/README.md](tests/integration/README.md). No new features or application/schema changes were made.

## Later: product features

- [ ] Self-service organizer account registration (currently manual Supabase Auth creation).
- [ ] Public team registration and organizer management of registrations/divisions/capacity.
- [ ] Manual entry-fee payment tracking (no payment processing required).
- [ ] Multiple organizers collaborating on one tournament.
- [ ] Audit logs for score edits and important organizer actions.
- [ ] Optional email notifications (registration and tournament updates).

## Monitor (no active fix)

- **Auth configuration advisory (November 15, 2026):** Supabase reports leaked-password protection disabled. No authorization bypass was found; no settings changed. Review availability/enablement when configuring organizer Auth. [Supabase guidance](https://supabase.com/docs/guides/auth/password-security#password-strength-and-leaked-password-protection).

- **Score submission responsiveness:** Previously intermittent slow/closing score modal; not reproduced recently. Investigate only if the issue returns with reproducible steps.
- **Performance and usability:** Respond to real beta-tester reports rather than making speculative changes.
- **Physical-device mobile usability:** Automated Chromium viewport testing passed at phone/tablet/desktop widths; observe actual phone feedback and address reproduced problems rather than requiring a manual QA marathon.
- **Very large tournaments / pagination:** [PR #1](https://github.com/cosvolleyball/tournament_builder/pull/1) was merged and deployed, and automated tests passed (37/37 total tests on QA branch). Deliberately defer creating a >1,000-row live tournament or requesting manual verification; revisit only if real user feedback shows a need.

## Already completed / verified

- [x] **November 15, 2026 regression checks:** 42/42 Vitest tests and production-configured TypeScript/Vite build passed; `npm audit --omit=dev` reported zero vulnerabilities. Read-only advisor/function-grant audit confirmed intentional public scoring and blocked internal/event-trigger execution.

- [x] **Mobile browser smoke QA (November 14, 2026):** [GitHub Actions run](https://github.com/cosvolleyball/tournament_builder/actions/runs/43658368582) passed all 7 automated scenarios (360/390/768/1280px homepage and sign-in; 360/390/768px local demo create/publish/score dialog plus double-elimination bracket scrolling), no console JavaScript errors or global horizontal overflow. Added reusable manual GitHub Actions test workflow. Does not cover real-device touch ergonomics or production authenticated tournament data.
- [x] **Wildcard/tiebreaker rules approved (November 14, 2026).** Organizer accepted pool finishing position, set-win percentage, point ratio, average point differential, and initial seed for cross-pool ranking; exactly two teams tied within a pool use head-to-head. Five additional score-based regression tests are saved in [PR #2](https://github.com/cosvolleyball/tournament_builder/pull/2); [GitHub QA run](https://github.com/cosvolleyball/tournament_builder/actions/runs/43656184851) passed **42/42 tests** and a production build. **Live score-data / qualifier / no-bye bracket parity verified November 15, 2026; see verification above.**
- [x] Deployed public beta on GitHub Pages with organizer login, public tournament directory, custom divisions, pool scoring, single/double elimination, customizable scoring, and wildcards.
- [x] Existing GitHub CI test suite and production build succeeded (32/32 tests in the latest inspected deployment run, October 31, 2026).
- [x] Additional independent tests of tournament logic and bracket-routing simulations were reported as passed on November 14, 2026. These tests were **not** added to the repository's permanent test suite.
- [x] Read-only Supabase permission audit: RLS enabled on 11 audited tables; no direct anonymous table-write grants.
- [x] Security hardening verified in Supabase: anonymous execution of the RLS event-trigger function blocked; public playoff scoring retained; explicit draft guard present.
- [x] GitHub Actions Supabase activity check running successfully.
- [x] November 14, 2026: PR #1 merged and GitHub Pages deployment succeeded; paginated pool/playoff fixture and score reads are live.
- [x] November 14, 2026: 95,294 additional local checks passed for round-robin schedules, seeds, byes, playoff qualification, volleyball scoring/series completion and division data independence. These checks were run against the checked-out TypeScript logic, not live Supabase RPCs.
- [x] November 14, 2026: isolated GitHub QA branch built successfully and passed 37/37 Vitest tests (five new pagination tests); [CI run](https://github.com/cosvolleyball/tournament_builder/actions/runs/43654818036).
- [x] November 14, 2026: read-only live anonymous Supabase smoke test: queries to 11 tables succeeded; no draft rows exposed. **No public tournaments or matches were visible**, so real-data visibility and owner-isolation authorization remain unverified; [CI run](https://github.com/cosvolleyball/tournament_builder/actions/runs/43655063516).

## Working notes

- Frontend: React, TypeScript, Vite; backend: Supabase; deployment: GitHub Pages.
- `npm run test` runs Vitest; `npm run build` type-checks and builds.
- Existing repo unit tests do **not** prove live Supabase RPC behavior, RLS enforcement as separate users, or mobile usability.
- The security-hardening SQL was applied to production Supabase after the October 31 deployment and should be preserved in future schema/migration work.
- The repository's starter `supabase/schema.sql` does not reconstruct the newer production database migrations. Before introducing database changes, version the effective migrations and test them against an isolated Supabase database.
- Avoid treating monitoring items as confirmed bugs without new evidence.
