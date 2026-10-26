/**
 * Tournament Builder data adapter (alpha build).
 *
 * The current UI edits ONE "Open" competition division per tournament.
 * Our v0.2 database supports several competition divisions under a tournament;
 * later, the UI can be extended without changing the storage model.
 *
 * Local demo mode continues to use the v0.1 browser-storage format.
 * Browser-side credentials are limited to the Supabase publishable/anon key;
 * all writes rely on Supabase Auth + database Row Level Security.
 */
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import type {
  TournamentBundle, Tournament, TournamentStatus, SetScore,
  Team, Pool, PoolTeam, Match, Division, BracketAssignments, PlayoffMatch, PlayoffRoundRule, RoundRulesByBracket,
} from './types';

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL?.trim();
const supabaseKey = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY?.trim();
export const supabase: SupabaseClient | null = supabaseUrl && supabaseKey
  ? createClient(supabaseUrl, supabaseKey, {
      auth: { autoRefreshToken: true, persistSession: true, detectSessionInUrl: true },
    })
  : null;
export const demoMode = !supabase;
const STORE = 'tournament-builder-demo-v1';

function demoBundles(): TournamentBundle[] {
  try { return JSON.parse(localStorage.getItem(STORE) ?? '[]') as TournamentBundle[]; }
  catch { return []; }
}
function writeDemo(bundles: TournamentBundle[]): void {
  localStorage.setItem(STORE, JSON.stringify(bundles));
}
function requireDb(): SupabaseClient {
  if (!supabase) throw new Error('Supabase is not configured.');
  return supabase;
}
function check(error: { message: string } | null): void {
  if (error) throw new Error(error.message);
}

/** Map database tournament + settings of one division to the v0.1 UI model. */
function asUiTournament(row: any, settings: any): Tournament {
  return {
    id: row.id, owner_id: row.owner_id, name: row.name, sport: row.sport,
    starts_on: row.starts_on, status: row.status, created_at: row.created_at,
    pool_count: settings?.pool_count ?? 1, pool_sets: settings?.pool_sets ?? 2,
    target_points: settings?.target_points ?? 21,
    win_by_two: settings?.win_by_two ?? true,
    point_cap: settings?.point_cap ?? null,
    seed_mode: settings?.seed_mode ?? 'snake',
  };
}

/** List tournaments owned by this authenticated organizer, without exposing drafts. */
export async function listTournaments(userId: string | null): Promise<Tournament[]> {
  if (demoMode) return demoBundles().map(b => b.tournament)
    .sort((a, b) => b.created_at.localeCompare(a.created_at));
  if (!userId) return [];
  const db = requireDb();
  const { data, error } = await db.from('tournaments').select('*')
    .eq('owner_id', userId).order('created_at', { ascending: false });
  check(error);
  const rows = data ?? [];
  if (!rows.length) return [];
  const { data: settings, error: divisionError } = await db
    .from('competition_divisions').select('*')
    .in('tournament_id', rows.map(t => t.id)).order('sort_order');
  check(divisionError);
  const firstDivision = new Map<string, any>();
  for (const division of settings ?? []) {
    if (!firstDivision.has(division.tournament_id)) firstDivision.set(division.tournament_id, division);
  }
  return rows.map(row => asUiTournament(row, firstDivision.get(row.id)));
}

/** Load the Open competition division (the only division exposed by this UI build). */
export async function getTournament(id: string): Promise<TournamentBundle> {
  if (demoMode) {
    const result = demoBundles().find(b => b.tournament.id === id);
    if (!result) throw new Error('Tournament not found in this browser.');
    return result;
  }

  const db = requireDb();
  const { data: tournament, error: tError } = await db.from('tournaments')
    .select('*').eq('id', id).single();
  check(tError);
  const { data: compDivisions, error: dError } = await db
    .from('competition_divisions').select('*').eq('tournament_id', id)
    .order('sort_order');
  check(dError);
  const chosen = compDivisions?.[0];
  if (!chosen) throw new Error('This tournament has no competition division yet.');

  const [teamsResult, poolsResult, poolTeamsResult, matchesResult, bracketsResult, rulesResult] = await Promise.all([
    db.from('teams').select('*').eq('division_id', chosen.id).order('seed'),
    db.from('pools').select('*').eq('division_id', chosen.id).order('sort_order'),
    db.from('pool_teams').select('*').eq('division_id', chosen.id),
    db.from('matches').select('*').eq('division_id', chosen.id).eq('stage', 'pool').order('sequence'),
    db.from('playoff_brackets').select('*').eq('division_id', chosen.id).order('sort_order'),
    db.from('playoff_round_rules').select('*').eq('division_id', chosen.id).order('round_number'),
  ]);
  for (const result of [teamsResult, poolsResult, poolTeamsResult, matchesResult, bracketsResult, rulesResult]) check(result.error);
  const rawMatches = matchesResult.data ?? [];
  // The `set_scores` table does not have tournament_id; filter by these match IDs.
  const matchIds = rawMatches.map(m => m.id);
  // In v0.6, read playoff fixtures separately so pool standings never
  // accidentally count elimination scores.
  const playoffMatchResult = await db.from('matches').select('*')
    .eq('division_id', chosen.id).eq('stage', 'playoff')
    .order('round_number').order('sequence');
  check(playoffMatchResult.error);
  const rawPlayoffs = playoffMatchResult.data ?? [];
  const playoffIds = rawPlayoffs.map(m => m.id);
  const playoffScoreResult = playoffIds.length
    ? await db.from('set_scores').select('*').in('match_id', playoffIds).order('set_number')
    : { data: [], error: null };
  check(playoffScoreResult.error);

  const scoreResult = matchIds.length
    ? await db.from('set_scores').select('*').in('match_id', matchIds).order('set_number')
    : { data: [], error: null };
  check(scoreResult.error);

  const teams: Team[] = (teamsResult.data ?? []).map(row => ({
    id: row.id, tournament_id: row.tournament_id, name: row.name, seed: row.seed,
  }));
  const pools: Pool[] = (poolsResult.data ?? []).map(row => ({
    id: row.id, tournament_id: row.tournament_id, label: row.label, sort_order: row.sort_order,
    scoring_override: row.scoring_override ?? false,
    target_points: row.target_points ?? null,
    win_by_two: row.win_by_two ?? null,
    point_cap: row.point_cap ?? null,
  }));
  const poolTeams: PoolTeam[] = (poolTeamsResult.data ?? []).map(row => ({
    tournament_id: row.tournament_id, pool_id: row.pool_id, team_id: row.team_id,
  }));
  const matches: Match[] = rawMatches.map(row => ({
    id: row.id, tournament_id: row.tournament_id, pool_id: row.pool_id,
    team_a_id: row.team_a_id, team_b_id: row.team_b_id,
    round_number: row.round_number, sequence: row.sequence, status: row.status,
  }));
  const divisions: Division[] = (bracketsResult.data ?? []).map(row => ({
    id: row.id, tournament_id: row.tournament_id, name: row.name,
    format: row.format, bracket_reset: row.bracket_reset, sort_order: row.sort_order, status: row.status,
  }));
  const scores: SetScore[] = (scoreResult.data ?? []).map(row => ({
    match_id: row.match_id, set_number: row.set_number, score_a: row.score_a, score_b: row.score_b,
  }));
  const playoffMatches: PlayoffMatch[] = rawPlayoffs.map(row => ({
    id: row.id, tournament_id: row.tournament_id, division_id: row.division_id,
    bracket_id: row.bracket_id, team_a_id: row.team_a_id, team_b_id: row.team_b_id,
    round_number: row.round_number, sequence: row.sequence, status: row.status,
  }));
  const playoffScores: SetScore[] = (playoffScoreResult.data ?? []).map(row => ({
    match_id: row.match_id, set_number: row.set_number,
    score_a: row.score_a, score_b: row.score_b,
  }));
  const roundRules: PlayoffRoundRule[] = (rulesResult.data ?? []).map(row => ({
    bracket_id:row.bracket_id, round_number:row.round_number,
    best_of:row.best_of as 1|3|5,
    target_points:row.target_points, win_by_two:row.win_by_two,point_cap:row.point_cap,
    decider_target_points:row.decider_target_points,
    decider_win_by_two:row.decider_win_by_two, decider_point_cap:row.decider_point_cap,
  }));
  return {
    tournament: asUiTournament(tournament, chosen), teams, pools,
    poolTeams, matches, scores, divisions, playoffMatches, playoffScores,roundRules,
  };
}

/**
 * Persist a v0.1 tournament as one Open competition division.
 * Insertion order follows foreign key dependencies. If anything fails,
 * removing the parent tournament cascades all child records.
 *
 * This is adequate for trusted alpha testers; before public beta, create
 * tournaments via a single transactional PostgreSQL RPC for atomicity.
 */
export async function createTournament(bundle: TournamentBundle, userId: string | null): Promise<void> {
  if (demoMode) { writeDemo([bundle, ...demoBundles()]); return; }
  if (!userId) throw new Error('Sign in before creating a tournament.');
  const db = requireDb();
  const t = bundle.tournament;
  const newDivisionId = crypto.randomUUID();
  const { error: tError } = await db.from('tournaments').insert({
    id: t.id, owner_id: userId, name: t.name, sport: t.sport,
    starts_on: t.starts_on, status: t.status, created_at: t.created_at,
  });
  check(tError);

  try {
    const { error: dError } = await db.from('competition_divisions').insert({
      id: newDivisionId, tournament_id: t.id, name: 'Open', sort_order: 0,
      status: 'draft', pool_count: t.pool_count, pool_sets: t.pool_sets,
      target_points: t.target_points, win_by_two: t.win_by_two,
      point_cap: t.point_cap ?? null, seed_mode: t.seed_mode,
    });
    check(dError);

    // Insert one table at a time, in foreign-key order. Using explicit table
    // names also lets Supabase's TypeScript API check each row's shape, rather
    // than combining incompatible row types into a union in a generic loop.
    const teams = bundle.teams.map(row => ({ ...row, division_id: newDivisionId }));
    if (teams.length) {
      const { error } = await db.from('teams').insert(teams);
      check(error);
    }

    const pools = bundle.pools.map(row => ({ ...row, division_id: newDivisionId }));
    if (pools.length) {
      const { error } = await db.from('pools').insert(pools);
      check(error);
    }

    const assignments = bundle.poolTeams.map(row => ({
      ...row, division_id: newDivisionId,
    }));
    if (assignments.length) {
      const { error } = await db.from('pool_teams').insert(assignments);
      check(error);
    }

    const brackets = bundle.divisions.map(row => ({
      ...row, division_id: newDivisionId, status: 'draft',
    }));
    if (brackets.length) {
      const { error } = await db.from('playoff_brackets').insert(brackets);
      check(error);
    }

    const matches = bundle.matches.map(row => ({
      ...row, division_id: newDivisionId, stage: 'pool', bracket_id: null,
    }));
    if (matches.length) {
      const { error } = await db.from('matches').insert(matches);
      check(error);
    }
  } catch (cause) {
    const { error: cleanupError } = await db.from('tournaments').delete().eq('id', t.id);
    if (cleanupError) throw new Error(
      `Setup failed and cleanup also failed: ${cleanupError.message}; original error: ${String(cause)}`
    );
    throw cause;
  }
}

/** Transition the tournament lifecycle. Alpha UI controls allowed transitions. */
export async function changeStatus(id: string, status: TournamentStatus): Promise<void> {
  if (demoMode) {
    const data = demoBundles();
    const result = data.find(b => b.tournament.id === id);
    if (!result) throw new Error('Tournament not found.');
    result.tournament.status = status; writeDemo(data);
    return;
  }
  const { error } = await requireDb().from('tournaments').update({ status }).eq('id', id);
  check(error);
}

/** Persist full pool results atomically via the SQL function from database v0.2. */
export async function submitScore(
  id: string,
  matchId: string,
  scores: SetScore[],
  publicEntry = false,
): Promise<void> {
  if (demoMode) {
    const data = demoBundles();
    const bundle = data.find(b => b.tournament.id === id);
    if (!bundle) throw new Error('Tournament not found.');
    const match = bundle.matches.find(m => m.id === matchId);
    if (!match) throw new Error('Match not found.');
    bundle.scores = [...bundle.scores.filter(s => s.match_id !== matchId), ...scores];
    match.status = 'completed';
    if (bundle.tournament.status === 'published') bundle.tournament.status = 'pool_play';
    writeDemo(data);
    return;
  }
  // Public visitors may submit only a FIRST score. Organizers use the existing
  // authenticated RPC, which can correct a recorded score. Server-side SQL
  // validates the match state; hiding a button is not a security boundary.
  const rpcName = publicEntry ? 'submit_public_pool_result' : 'submit_pool_result';
  const { error } = await requireDb().rpc(rpcName, {
    p_match_id: matchId,
    p_scores: scores.map(s => ({
      set_number: s.set_number, score_a: s.score_a, score_b: s.score_b,
    })),
  });
  check(error);
}

/** Removes one tournament and all children via database foreign-key cascades. */
export async function deleteTournament(id: string): Promise<void> {
  if (demoMode) { writeDemo(demoBundles().filter(b => b.tournament.id !== id)); return; }
  const { error } = await requireDb().from('tournaments').delete().eq('id', id);
  check(error);
}


/**
 * Organizer-only, transactional pool finalization and bracket generation.
 * The server validates the owner, all completed pool scores, all team IDs,
 * and every bracket configuration. The client preview is NOT authoritative.
 */
export async function finalizePoolAndCreatePlayoffs(
  bundle: TournamentBundle,
  assignments: BracketAssignments,
  roundRules: RoundRulesByBracket,
): Promise<void> {
  if (demoMode) {
    // Local demo supports preview only, not a fake persisted playoff engine.
    throw new Error('Bracket finalization requires the connected Supabase project.');
  }
  const { error } = await requireDb().rpc('finalize_with_playoff_round_rules', {
    p_tournament_id: bundle.tournament.id,
    p_assignments: assignments,
    p_round_rules: roundRules,
  });
  check(error);
}

/**
 * Score an entire playoff series atomically. Public visitors can submit only
 * an unfinished match. Supabase validates per-round rules and advances winner.
 */
export async function submitPlayoffScore(matchId:string,scores:SetScore[]):Promise<void> {
  if (demoMode) throw new Error('Playoff scoring requires Supabase.');
  const {error}=await requireDb().rpc('submit_public_playoff_series',{
    p_match_id:matchId,
    p_scores:scores.map(s=>({set_number:s.set_number,score_a:s.score_a,score_b:s.score_b})),
  });
  check(error);
}

/** Only an authenticated tournament owner can correct completed playoff sets. */
export async function correctPlayoffScore(matchId:string,scores:SetScore[]):Promise<void> {
  if (demoMode) throw new Error('Playoff corrections require Supabase.');
  const {error}=await requireDb().rpc('correct_playoff_series',{
    p_match_id:matchId,
    p_scores:scores.map(s=>({set_number:s.set_number,score_a:s.score_a,score_b:s.score_b})),
  });
  check(error);
}
