/**
 * Pure playoff calculations; safe to run in the browser for PREVIEWS.
 * The actual tournament transition is validated and generated in Supabase,
 * never trusted just because this TypeScript function returned a result.
 */
import { standingsForPool } from './engine';
import type { TournamentBundle, DivisionFormat } from './types';

/** Per-bracket rule count: upper rounds plus grand and optional reset final.
 * Losers' rounds share the corresponding upper-round rule to keep the UI lean.
 */
export function playoffRoundCount(count:number, format:DivisionFormat):number {
  if (!Number.isInteger(count) || count<2 || count>64) return 0;
  return Math.ceil(Math.log2(count))+(format==='double'?2:0);
}

/** Standard balanced seed placement. 8 slots => 1,8,4,5,2,7,3,6. */
export function seedPositions(participantCount: number): number[] {
  if (!Number.isInteger(participantCount) || participantCount < 2 || participantCount > 64) {
    throw new Error('A single-elimination bracket requires 2–64 teams.');
  }
  let positions = [1, 2];
  while (positions.length < participantCount) {
    const nextSize = positions.length * 2;
    positions = positions.flatMap(seed => [seed, nextSize + 1 - seed]);
  }
  return positions;
}

/**
 * Compare candidates by finishing position *first*, then normalized stats.
 * A team in second place cannot outrank a first-place team from another pool.
 * Organizer can override all placements and seeds before finalization.
 */
export function rankedPoolTeams(bundle: TournamentBundle): string[] {
  const records = bundle.pools.flatMap(pool => standingsForPool(bundle, pool.id));
  return records.sort((a, b) => a.rank - b.rank
    || b.winPct - a.winPct
    || b.pointRatio - a.pointRatio
    || b.avgDiff - a.avgDiff
    || a.team.seed - b.team.seed).map(record => record.team.id);
}

/**
 * Split a sorted team list across brackets in configured order. The first
 * bracket receives the extra team if the count doesn't divide evenly.
 */
export function suggestedAssignments(bundle: TournamentBundle): Record<string, string[]> {
  const result: Record<string, string[]> = {};
  const all = rankedPoolTeams(bundle);
  const brackets = [...bundle.divisions].sort((a, b) => a.sort_order - b.sort_order);
  brackets.forEach((bracket, index) => {
    const base = Math.floor(all.length / brackets.length);
    const additional = all.length % brackets.length;
    const offset = index * base + Math.min(index, additional);
    result[bracket.id] = all.slice(offset, offset + base + (index < additional ? 1 : 0));
  });
  return result;
}

/**
 * Pick qualifiers without assuming every pool has played the same number of
 * matches or uses the same target score. Pool finishing place comes first;
 * cross-pool wildcard candidates then use per-set win percentage, point ratio,
 * average point differential, and initial seed as deterministic tie breakers.
 *
 * Final advancement is reviewed by the organizer, not made irreversible here.
 */
export type QualificationMode = 'all' | 'per_pool' | 'overall';

export interface QualificationRule {
  mode: QualificationMode;
  topPerPool: number;
  nextPlaceWildcards: number;
  overallCount: number;
}

export function qualifiedTeamIds(bundle: TournamentBundle, rule: QualificationRule): string[] {
  const sorted = rankedPoolTeams(bundle);
  if (rule.mode === 'all') return sorted;
  if (rule.mode === 'overall') {
    return sorted.slice(0, Math.max(0, Math.min(sorted.length, Math.trunc(rule.overallCount) || 0)));
  }
  const top = Math.max(0, Math.trunc(rule.topPerPool) || 0);
  const picked = new Set<string>();
  const nextPlace: string[] = [];
  for (const pool of bundle.pools) {
    const ordered = standingsForPool(bundle, pool.id);
    ordered.slice(0, top).forEach(entry => picked.add(entry.team.id));
    if (ordered[top]) nextPlace.push(ordered[top].team.id);
  }
  // `sorted` already sorts equal finishing positions by normalized records.
  const wildcardCount = Math.max(0, Math.trunc(rule.nextPlaceWildcards) || 0);
  const wildcards = sorted.filter(id => nextPlace.includes(id)).slice(0, wildcardCount);
  wildcards.forEach(id => picked.add(id));
  return sorted.filter(id => picked.has(id));
}

/** Distribute only qualified teams among configured playoff brackets. */
export function distributeQualifiers(bundle: TournamentBundle, teamIds: string[]): Record<string,string[]> {
  const brackets = [...bundle.divisions].sort((a,b) => a.sort_order - b.sort_order);
  const result: Record<string,string[]> = Object.fromEntries(brackets.map(bracket => [bracket.id, []]));
  if (!brackets.length) return result;
  brackets.forEach((bracket, index) => {
    const base = Math.floor(teamIds.length / brackets.length);
    const extra = teamIds.length % brackets.length;
    const offset = index * base + Math.min(index, extra);
    result[bracket.id] = teamIds.slice(offset, offset + base + (index < extra ? 1 : 0));
  });
  return result;
}

/** A bracket preview is separate from the database state. */
export interface PreviewMatch {
  round: number;
  index: number;
  seedA: number | null;
  seedB: number | null;
  teamA: string | null;
  teamB: string | null;
}
export function previewSingleElimination(orderedTeamIds: string[]): PreviewMatch[] {
  const positions = seedPositions(orderedTeamIds.length);
  const rounds = Math.log2(positions.length);
  const matches: PreviewMatch[] = [];
  for (let round = 1; round <= rounds; round++) {
    const matchCount = positions.length / (2 ** round);
    for (let index = 0; index < matchCount; index++) {
      const seedA = round === 1 ? positions[index * 2] : null;
      const seedB = round === 1 ? positions[index * 2 + 1] : null;
      matches.push({
        round, index: index + 1, seedA, seedB,
        teamA: seedA && seedA <= orderedTeamIds.length ? orderedTeamIds[seedA - 1] : null,
        teamB: seedB && seedB <= orderedTeamIds.length ? orderedTeamIds[seedB - 1] : null,
      });
    }
  }
  return matches;
}

/**
 * Qualifying is optional: a team may be excluded from every playoff bracket.
 * No team may enter two brackets. At least two are needed in each bracket.
 */
export function validateAssignments(bundle: TournamentBundle, assignments: Record<string, string[]>): string | null {
  const brackets = bundle.divisions;
  if (!brackets.length) return null;
  const known = new Set(bundle.teams.map(team => team.id));
  const used = new Set<string>();
  if (Object.keys(assignments).length !== brackets.length || Object.keys(assignments).some(k => !brackets.some(b => b.id === k))) {
    return 'Bracket assignments do not match the configured brackets.';
  }
  for (const bracket of brackets) {
    const participants = assignments[bracket.id];
    if (!participants || participants.length < 2) return `“${bracket.name}” needs at least two teams.`;
    if (participants.length > 64) return `“${bracket.name}” has too many teams.`;
    for (const id of participants) {
      if (!known.has(id) || used.has(id)) return 'A team is missing, duplicated, or belongs to another tournament.';
      used.add(id);
    }
  }
  return null;
}

/** First-round byes are absent only when each bracket is a power of two. */
export function isByeFreeSize(size: number): boolean {
  return Number.isInteger(size) && size >= 2 && size <= 64 && (size & (size - 1)) === 0;
}

/** Suggest the *next-place* wildcards needed for a full no-bye bracket.
 * This is meaningful for one playoff bracket. The UI validates every bracket
 * after seeds have been distributed, including Gold/Silver configurations.
 */
export function suggestedByeFreeWildcards(bundle: TournamentBundle, topPerPool: number): {
  count: number; target: number; available: number; possible: boolean;
} {
  const top = Math.max(0, Math.trunc(topPerPool) || 0);
  let automatic = 0;
  let available = 0;
  for (const pool of bundle.pools) {
    const count = standingsForPool(bundle, pool.id).length;
    automatic += Math.min(top,count);
    if (count > top) available += 1;
  }
  const bracketCount = Math.max(1, bundle.divisions.length);
  let each = 2;
  while (each * bracketCount < automatic && each < 64) each *= 2;
  const target = each * bracketCount;
  return {count: Math.max(0,target-automatic), target, available,
    possible: each <= 64 && target - automatic <= available};
}

export function byeFreeAssignmentsError(bundle: TournamentBundle, assignments: Record<string,string[]>): string | null {
  for (const bracket of bundle.divisions) {
    const size = assignments[bracket.id]?.length ?? 0;
    if (!isByeFreeSize(size)) {
      return `“${bracket.name}” has ${size} entrants. To avoid first-round byes, use 2, 4, 8, 16, 32 or 64 teams in each bracket.`;
    }
  }
  return null;
}
