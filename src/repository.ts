import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import type { TournamentBundle, Tournament, TournamentStatus, SetScore } from './types';

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL?.trim();
const supabaseKey = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY?.trim();
export const supabase: SupabaseClient | null = supabaseUrl && supabaseKey
  ? createClient(supabaseUrl, supabaseKey, { auth: { autoRefreshToken: true, persistSession: true, detectSessionInUrl: true } })
  : null;
export const demoMode = !supabase;
const STORE = 'tournament-builder-demo-v1';

function demoBundles(): TournamentBundle[] {
  try { return JSON.parse(localStorage.getItem(STORE) ?? '[]') as TournamentBundle[]; }
  catch { return []; }
}
function writeDemo(bundles: TournamentBundle[]) { localStorage.setItem(STORE, JSON.stringify(bundles)); }
function requireDb(): SupabaseClient { if (!supabase) throw new Error('Supabase is not configured.'); return supabase; }
function check(error: { message: string } | null): void { if (error) throw new Error(error.message); }

export async function listTournaments(userId: string | null): Promise<Tournament[]> {
  if (demoMode) return demoBundles().map(b => b.tournament).sort((a, b) => b.created_at.localeCompare(a.created_at));
  if (!userId) return [];
  const { data, error } = await requireDb().from('tournaments').select('*').eq('owner_id', userId).order('created_at', { ascending: false });
  check(error);
  return (data ?? []) as Tournament[];
}

export async function getTournament(id: string): Promise<TournamentBundle> {
  if (demoMode) {
    const result = demoBundles().find(b => b.tournament.id === id);
    if (!result) throw new Error('Tournament not found in this browser.');
    return result;
  }
  const db = requireDb();
  const [t, teams, pools, poolTeams, matches, scores, divisions] = await Promise.all([
    db.from('tournaments').select('*').eq('id', id).single(),
    db.from('teams').select('*').eq('tournament_id', id).order('seed'),
    db.from('pools').select('*').eq('tournament_id', id).order('sort_order'),
    db.from('pool_teams').select('*').eq('tournament_id', id),
    db.from('matches').select('*').eq('tournament_id', id).order('sequence'),
    db.from('set_scores').select('*, matches!inner(tournament_id)').eq('matches.tournament_id', id),
    db.from('playoff_divisions').select('*').eq('tournament_id', id).order('sort_order'),
  ]);
  for (const result of [t, teams, pools, poolTeams, matches, scores, divisions]) check(result.error);
  return {
    tournament: t.data as Tournament,
    teams: teams.data ?? [], pools: pools.data ?? [], poolTeams: poolTeams.data ?? [],
    matches: matches.data ?? [],
    scores: (scores.data ?? []).map(s => ({ match_id: s.match_id, set_number: s.set_number, score_a: s.score_a, score_b: s.score_b })),
    divisions: divisions.data ?? [],
  };
}

export async function createTournament(bundle: TournamentBundle, userId: string | null): Promise<void> {
  if (demoMode) { writeDemo([bundle, ...demoBundles()]); return; }
  if (!userId) throw new Error('Sign in before creating a tournament.');
  const db = requireDb();
  const { error: startError } = await db.from('tournaments').insert({ ...bundle.tournament, owner_id: userId });
  check(startError);
  // Deleting the parent automatically cascades partial children if any insert fails.
  try {
    for (const [table, rows] of [
      ['teams', bundle.teams], ['pools', bundle.pools], ['pool_teams', bundle.poolTeams],
      ['matches', bundle.matches], ['playoff_divisions', bundle.divisions],
    ] as const) {
      if (!rows.length) continue;
      const { error } = await db.from(table).insert(rows);
      check(error);
    }
  } catch (cause) {
    const { error: cleanupError } = await db.from('tournaments').delete().eq('id', bundle.tournament.id);
    if (cleanupError) throw new Error(`Tournament setup failed, and automatic cleanup failed: ${cleanupError.message}. Original error: ${String(cause)}`);
    throw cause;
  }
}

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

export async function submitScore(id: string, matchId: string, scores: SetScore[]): Promise<void> {
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
  const { error } = await requireDb().rpc('submit_pool_result', {
    p_match_id: matchId,
    p_scores: scores.map(s => ({ set_number: s.set_number, score_a: s.score_a, score_b: s.score_b })),
  });
  check(error);
}

export async function deleteTournament(id: string): Promise<void> {
  if (demoMode) { writeDemo(demoBundles().filter(b => b.tournament.id !== id)); return; }
  const { error } = await requireDb().from('tournaments').delete().eq('id', id);
  check(error);
}
