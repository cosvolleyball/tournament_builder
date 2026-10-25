/**
 * Pure playoff calculations; safe to run in the browser for PREVIEWS.
 * The actual tournament transition is validated and generated in Supabase,
 * never trusted just because this TypeScript function returned a result.
 */
import { standingsForPool } from './engine';
import type { TournamentBundle } from './types';

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
 * Every team enters exactly one of the existing brackets. Pool-only
 * tournaments have zero brackets and are handled separately.
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
    if (bracket.format !== 'single') return 'Double-elimination brackets will be available in the next development batch.';
    const participants = assignments[bracket.id];
    if (!participants || participants.length < 2) return `“${bracket.name}” needs at least two teams.`;
    if (participants.length > 64) return `“${bracket.name}” has too many teams.`;
    for (const id of participants) {
      if (!known.has(id) || used.has(id)) return 'A team is missing, duplicated, or belongs to another tournament.';
      used.add(id);
    }
  }
  if (used.size !== known.size) return 'Every team must be assigned to exactly one bracket.';
  return null;
}
