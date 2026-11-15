# Tournament Builder — Backlog

_Last updated: November 14, 2026_

**Status:** Public beta; no currently confirmed release-blocking defect.  
**Live site:** https://cosvolleyball.github.io/tournament_builder/  
**Repository:** https://github.com/cosvolleyball/tournament_builder (branch: `master`)

This file is the source of truth for remaining work. When something is completed, update this file in the same change so a future conversation or contributor can pick up where we left off.

## Next: verification

- [ ] **Live Supabase integration testing.** On disposable test tournaments, verify double-elimination advancement (including byes and grand-final reset/no reset), score corrections and downstream match routing, and independent progression of custom divisions. Cover representative sizes such as 5, 8, 14, and 16 teams. **Unit tests do not replace database integration tests.**
- [ ] **Live authorization testing.** As anonymous, organizer A, and organizer B, verify that drafts are not publicly readable, an organizer cannot edit another organizer's tournaments, and public score entry cannot overwrite a completed result. Test against disposable tournament records.
- [ ] **Mobile usability check.** Test tournament navigation, horizontal bracket scrolling, and score-entry dialogs on an actual phone; address any reproduced issues.
- [ ] **Wildcard ranking/tiebreaker rules review (policy confirmation only).** Reviewed current TypeScript preview and added five completed-score regression tests on QA branch ([CI run](https://github.com/cosvolleyball/tournament_builder/actions/runs/43656184851), 42/42 passed with build). Present policy: place first, then set-win %, point ratio, average point differential, initial seed; two-team pool ties use head-to-head. Await organizer approval of these tiebreakers. Production Supabase finalization rules are not yet independently verified against the client preview.

## Later: product features

- [ ] Self-service organizer account registration (currently manual Supabase Auth creation).
- [ ] Public team registration and organizer management of registrations/divisions/capacity.
- [ ] Manual entry-fee payment tracking (no payment processing required).
- [ ] Multiple organizers collaborating on one tournament.
- [ ] Audit logs for score edits and important organizer actions.
- [ ] Optional email notifications (registration and tournament updates).

## Monitor (no active fix)

- **Score submission responsiveness:** Previously intermittent slow/closing score modal; not reproduced recently. Investigate only if the issue returns with reproducible steps.
- **Performance and usability:** Respond to real beta-tester reports rather than making speculative changes.
- **Very large tournaments / pagination:** [PR #1](https://github.com/cosvolleyball/tournament_builder/pull/1) was merged and deployed, and automated tests passed (37/37 total tests on QA branch). Deliberately defer creating a >1,000-row live tournament or requesting manual verification; revisit only if real user feedback shows a need.

## Already completed / verified

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
