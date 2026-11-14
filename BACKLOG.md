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
- [ ] **Wildcard ranking/tiebreaker rules review.** Confirm intended policy for uneven pools, ties, different scoring formats, and bye-free playoff qualification. Adjust only if the desired real-world rules differ from the implementation.

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

## Already completed / verified

- [x] Deployed public beta on GitHub Pages with organizer login, public tournament directory, custom divisions, pool scoring, single/double elimination, customizable scoring, and wildcards.
- [x] Existing GitHub CI test suite and production build succeeded (32/32 tests in the latest inspected deployment run, October 31, 2026).
- [x] Additional independent tests of tournament logic and bracket-routing simulations were reported as passed on November 14, 2026. These tests were **not** added to the repository's permanent test suite.
- [x] Read-only Supabase permission audit: RLS enabled on 11 audited tables; no direct anonymous table-write grants.
- [x] Security hardening verified in Supabase: anonymous execution of the RLS event-trigger function blocked; public playoff scoring retained; explicit draft guard present.
- [x] GitHub Actions Supabase activity check running successfully.

## Working notes

- Frontend: React, TypeScript, Vite; backend: Supabase; deployment: GitHub Pages.
- `npm run test` runs Vitest; `npm run build` type-checks and builds.
- Existing repo unit tests do **not** prove live Supabase RPC behavior, RLS enforcement as separate users, or mobile usability.
- The security-hardening SQL was applied to production Supabase after the October 31 deployment and should be preserved in future schema/migration work.
- Avoid treating monitoring items as confirmed bugs without new evidence.
