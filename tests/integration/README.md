# Live integration and authorization verification

Verified November 15, 2026 against the effective Tournament Builder Supabase database
(`gvjejnuzgjkrixqrbuza`) and repository commit `61820ace318fab968483d44d57b69a77b9528d4b`.
No application code, database schema, production configuration, or existing tournaments
were changed. These tests are manual and must not be added to scheduled CI against production.

## Results

| Check | Result |
| --- | --- |
| Double elimination: 5, 8, 14, 16 entrants × three final outcomes | 12/12 passed |
| Pool scores in those primary divisions | 747 accepted; public overwrites rejected |
| Playoff matches in those brackets | 238 completed; routing and loss counts checked |
| Independent second division | 12/12 remained in pool play until separately finalized |
| Authorization and scoring validation matrix | 91 checks passed |
| Anonymous HTTP draft visibility | Hidden in all seven populated tables queried; scoring rejected |
| Simultaneous anonymous HTTP pool submissions | One HTTP 204, one HTTP 400; exactly the accepted score stored |
| Simultaneous anonymous HTTP playoff submissions | One HTTP 204, one HTTP 400; exactly the accepted score stored |
| Wildcard database/frontend parity | 26 live scores from 5/5/4 pools; top two plus two wildcards = 8 teams, zero first-round byes |
| Real organizer browser workflow | Login, draft creation, second custom division, reload, publish/start, scoring/corrections, separate finalization and full double-elimination completion passed |
| Logout and public browser access | Redirected home; back did not restore workspace; completed public bracket had no edit/organizer controls |
| Existing Vitest suite | 42/42 passed |
| TypeScript / Vite build | Passed, including a build with the project's publishable client configuration |
| Production dependency audit | `npm audit --omit=dev`: zero reported vulnerabilities |
| Cleanup | Zero test tournaments remain; committed HTTP fixture and synthetic Auth user deleted; browser fixture parent/divisions/matches deleted |

The bracket tests check upper and lower advancement after every result, structural byes,
champion/loss counts, reset and no-reset outcomes, and corrections to both winner and loser
routes. They also check that reversing an unplayed-reset grand final removes/recreates the
reset, and that changing a winner after a descendant/reset has played is blocked.

The authorization matrix uses actual `anon` and `authenticated` PostgreSQL roles with
transaction-local JWT claims for two synthetic Auth identities. It checks non-vacuous
draft reads across all 11 application tables, owner visibility, organizer B's inability
to update/delete A's tournament and children, impersonated owner inserts, ownership
transfer, protected RPCs, and absence of anonymous direct-write grants. Positive owner
and public scoring tests accompany the rejection tests.

Scoring checks cover malformed/null/string/fractional/negative/tied/out-of-range scores,
incomplete and extra sets, two-set pool splits, pool-specific overrides, point caps,
deciding-set rules, best-of-1/3/5, and atomic rollback of partial invalid submissions.
Both public playoff endpoints reject draft tournaments.

Wildcard rankings are calculated by the frontend; there is no separate SQL standings
implementation to compare. The parity test reads scores actually accepted/stored by the
live RPCs, feeds them through the real TypeScript ranking functions, checks independently
expected qualifier membership, and verifies the database accepts the eight-team assignment
with the no-byes requirement. The existing score-based tiebreaker tests remain relevant.

## Security advisor interpretation

- No missing RLS on public application tables was found. Private audit tables have RLS
  with no client policies, so client access is denied; this is intentional.
- Public SECURITY DEFINER scoring is intentional. The checks above verify draft guards,
  completed-result protection, score validation and organizer-only correction/finalization.
- Old generation wrappers, internal bracket functions and `rls_auto_enable()` are not
  executable by anonymous or authenticated clients. Reviewed functions have fixed search
  paths and do not use user-editable metadata for authorization.
- **Leaked-password protection is disabled.** This remains a configuration advisory,
  not a demonstrated authorization bypass. No Auth settings were changed.
  [Supabase password-protection guidance](https://supabase.com/docs/guides/auth/password-security#password-strength-and-leaked-password-protection).

## Re-running safely

`live-rollback.sql` and `security-rollback.sql` must each run as one complete request on
an administrative SQL connection. Both begin a transaction, create random synthetic Auth
identities and tournament rows, switch into client roles for assertions, return results,
and finish with `ROLLBACK`. They use statement/lock timeouts. A failed assertion aborts
that transaction; on a persistent SQL connection issue `ROLLBACK` before retrying.
Do not remove the final rollback. Never substitute real tournament/user IDs.
The starter `supabase/schema.sql` alone is insufficient to reconstruct the effective DB.

For wildcard parity, from the repository root:

```sh
node tests/integration/wildcard-parity.mjs prepare /tmp/tb-wildcard
```

Run the generated `/tmp/tb-wildcard.sql` as one administrative request. Save the returned
`result` object (not the surrounding connector wrapper) to `/tmp/tb-wildcard-result.json`.
Then run:

```sh
node tests/integration/wildcard-parity.mjs check /tmp/tb-wildcard
```

`http-race.mjs` requires a separately provisioned **disposable** committed tournament,
a configuration JSON `{ "url": "...", "key": "<publishable key>" }`, and a fixture manifest
containing `tournament`, `division`, `bracket`, `match`, `owner`, `a`, `b` UUIDs. It enforces
the exact QA tournament name in the script before submitting. Run once for an unfinished
pool match, finalize that disposable two-team single-elimination bracket as its owner,
and then run once for its unfinished playoff match. Delete only the exact fixture parent
and synthetic Auth identity afterward, and verify they are absent. The November 15 run
completed that cleanup. Never run this script on an existing event.

## Limits

These results prove live database RPC/RLS behavior, anonymous PostgREST behavior, and
one real organizer's authenticated browser workflow. After secure user-provided login,
the browser created a separate disposable tournament with custom A and BB divisions,
reloaded its private draft, published/started it, submitted seven pool results, corrected
a two-set result and verified standings, finalized the pool-only BB division while A
remained active, generated a bye-free four-team double-elimination bracket, submitted
six playoff results, corrected an early winner and verified both next slots, and displayed
the champion. Sign-out returned home; Back did not restore the organizer workspace.
Reopening the completed public bracket exposed no edit, delete, copy-link or finalization
controls. No site-origin console errors were observed (browser-extension metadata errors
were excluded). The disposable parent and all divisions/matches were then deleted through
an exact-ID/name connector cleanup; zero remaining rows were verified. The existing
organizer account was not deleted or changed, and no existing tournaments were edited.

Organizer A/B database authorization used synthetic role/claim contexts, not two actual
GoTrue sessions. A second real organizer browser identity and time-based token-expiry/
renewal behavior were not exercised. Reload persistence was verified, but is not a claim
that forced token refresh or revocation was tested. No existing account password was
changed. These are explicit coverage limits rather than passing results.

The HTTP races cover duplicate submissions to the same match, not load testing or all
possible multi-match locking schedules. Mobile browser smoke coverage is documented in
BACKLOG.md; this run adds no physical-device claim. Passing tests and a clean dependency
audit do not establish that every possible vulnerability has been excluded.
