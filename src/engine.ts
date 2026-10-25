import type { NewTournamentInput, TournamentBundle, Team, PoolTeam, Match, SetScore, Pool } from './types';

const newId = () => crypto.randomUUID();

/** Fair distribution when the user-provided order represents descending seed order. */
export function assignPools(teamIds: string[], poolIds: string[], mode: 'snake' | 'random', random = Math.random): PoolTeam[] {
  if (!poolIds.length) throw new Error('At least one pool is required.');
  const ordered = [...teamIds];
  if (mode === 'random') {
    for (let i = ordered.length - 1; i > 0; i--) {
      const j = Math.floor(random() * (i + 1));
      [ordered[i], ordered[j]] = [ordered[j], ordered[i]];
    }
  }
  return ordered.map((team_id, index) => {
    const cycle = Math.floor(index / poolIds.length);
    const column = index % poolIds.length;
    const poolPosition = mode === 'snake' && cycle % 2 === 1 ? poolIds.length - column - 1 : column;
    return { tournament_id: '', pool_id: poolIds[poolPosition], team_id };
  });
}

/** One matchup per unordered pair, including odd-numbered pools. */
export function roundRobin(teamIds: string[], poolId: string, tournamentId: string, firstSequence = 1): Match[] {
  if (teamIds.length < 2) return [];
  const rotation: Array<string | null> = [...teamIds];
  if (rotation.length % 2 !== 0) rotation.push(null);
  const n = rotation.length;
  const matches: Match[] = [];
  let sequence = firstSequence;
  for (let round = 0; round < n - 1; round++) {
    for (let i = 0; i < n / 2; i++) {
      const a = rotation[i], b = rotation[n - 1 - i];
      if (a && b) matches.push({
        id: newId(), tournament_id: tournamentId, pool_id: poolId,
        team_a_id: a, team_b_id: b, round_number: round + 1,
        sequence: sequence++, status: 'scheduled',
      });
    }
    rotation.splice(1, 0, rotation.pop()!);
  }
  return matches;
}

export function createBundle(input: NewTournamentInput): TournamentBundle {
  const distinct = new Set(input.teamNames.map(n => n.trim().toLocaleLowerCase()));
  if (input.teamNames.length < 2 || input.teamNames.length > 64) throw new Error('Enter between 2 and 64 teams.');
  if (distinct.size !== input.teamNames.length || distinct.has('')) throw new Error('Team names must be nonempty and unique.');
  if (input.poolCount < 1 || input.poolCount > Math.floor(input.teamNames.length / 2)) throw new Error('Each pool must contain at least two teams.');
  // The number and names of playoff brackets are organizer-selected.
  // An empty list is valid for a pool-play-only tournament.
  if (input.playoffBrackets.length > 8) throw new Error('A division supports up to eight playoff brackets.');
  const names = input.playoffBrackets.map(bracket => bracket.name.trim().toLocaleLowerCase());
  if (names.some(name => !name) || new Set(names).size !== names.length) {
    throw new Error('Playoff bracket names must be nonempty and unique.');
  }
  const id = newId();
  const tournament = {
    id, owner_id: null, name: input.name.trim(), sport: input.sport.trim() || 'Volleyball',
    starts_on: input.startsOn || null, status: 'draft' as const, pool_count: input.poolCount,
    pool_sets: input.poolSets, target_points: input.targetPoints, win_by_two: input.winByTwo,
    seed_mode: input.seedMode, created_at: new Date().toISOString(),
  };
  if (!tournament.name) throw new Error('Enter a tournament name.');
  const teams = input.teamNames.map((name, index) => ({ id: newId(), tournament_id: id, name: name.trim(), seed: index + 1 }));
  const pools: Pool[] = Array.from({ length: input.poolCount }, (_, index) => ({
    id: newId(), tournament_id: id, label: `Pool ${String.fromCharCode(65 + index)}`, sort_order: index + 1,
  }));
  const poolTeams = assignPools(teams.map(t => t.id), pools.map(p => p.id), input.seedMode)
    .map(row => ({ ...row, tournament_id: id }));
  let sequence = 1;
  const matches = pools.flatMap(pool => {
    const assigned = poolTeams.filter(r => r.pool_id === pool.id).map(r => r.team_id);
    const fixtureList = roundRobin(assigned, pool.id, id, sequence);
    sequence += fixtureList.length;
    return fixtureList;
  });
  const divisions = input.playoffBrackets.map((bracket, index) => ({
    id: newId(), tournament_id: id, name: bracket.name.trim(),
    format: bracket.format, bracket_reset: bracket.bracketReset,
    sort_order: index + 1,
  }));
  return { tournament, teams, pools, poolTeams, matches, scores: [], divisions };
}

export function countCompleteMatchSets(match: Match, scores: SetScore[], required: number): SetScore[] {
  const setScores = scores.filter(s => s.match_id === match.id);
  return setScores.length === required ? setScores : [];
}

export interface Standing {
  team: Team; wins: number; losses: number; played: number; pointsFor: number;
  pointsAgainst: number; winPct: number; pointRatio: number; avgDiff: number; rank: number;
}
export function standingsForPool(bundle: TournamentBundle, poolId: string): Standing[] {
  const members = bundle.poolTeams.filter(x => x.pool_id === poolId);
  const byId = new Map(bundle.teams.map(team => [team.id, team]));
  const records = members.map(row => ({
    team: byId.get(row.team_id)!, wins: 0, losses: 0, played: 0,
    pointsFor: 0, pointsAgainst: 0, winPct: 0, pointRatio: 0, avgDiff: 0, rank: 0,
  }));
  const map = new Map(records.map(s => [s.team.id, s]));
  const matches = bundle.matches.filter(m => m.pool_id === poolId && m.status === 'completed');
  for (const match of matches) {
    const a = map.get(match.team_a_id), b = map.get(match.team_b_id);
    if (!a || !b) continue;
    for (const set of countCompleteMatchSets(match, bundle.scores, bundle.tournament.pool_sets)) {
      a.played++; b.played++;
      a.pointsFor += set.score_a; a.pointsAgainst += set.score_b;
      b.pointsFor += set.score_b; b.pointsAgainst += set.score_a;
      if (set.score_a > set.score_b) { a.wins++; b.losses++; }
      else { b.wins++; a.losses++; }
    }
  }
  for (const r of records) {
    r.winPct = r.played ? r.wins / r.played : 0;
    r.pointRatio = r.pointsAgainst ? r.pointsFor / r.pointsAgainst : (r.pointsFor ? Infinity : 0);
    r.avgDiff = r.played ? (r.pointsFor - r.pointsAgainst) / r.played : 0;
  }
  // For tied set records involving exactly two teams, head-to-head set record breaks the tie.
  const h2h = (a: Standing, b: Standing): number => {
    let awins = 0, bwins = 0;
    for (const match of matches) {
      if (![match.team_a_id, match.team_b_id].includes(a.team.id) || ![match.team_a_id, match.team_b_id].includes(b.team.id)) continue;
      for (const s of countCompleteMatchSets(match, bundle.scores, bundle.tournament.pool_sets)) {
        const winner = s.score_a > s.score_b ? match.team_a_id : match.team_b_id;
        if (winner === a.team.id) awins++; else bwins++;
      }
    }
    return awins === bwins ? 0 : bwins - awins;
  };
  records.sort((a, b) => b.winPct - a.winPct || b.pointRatio - a.pointRatio || b.avgDiff - a.avgDiff || a.team.seed - b.team.seed);
  // Apply head-to-head only when an exact two-team set-win-percentage tie group exists.
  for (let i = 0; i < records.length - 1; i++) {
    if (records[i].winPct !== records[i + 1].winPct) continue;
    const first = i === 0 || records[i - 1].winPct !== records[i].winPct;
    const last = i + 2 === records.length || records[i + 2].winPct !== records[i].winPct;
    if (first && last && h2h(records[i], records[i + 1]) > 0) [records[i], records[i + 1]] = [records[i + 1], records[i]];
  }
  records.forEach((r, i) => { r.rank = i + 1; });
  return records;
}

export function scoreError(scores: Array<[number, number]>, sets: 1 | 2, points: number, winByTwo: boolean): string | null {
  if (scores.length !== sets) return `Enter all ${sets} set scores.`;
  for (const [a, b] of scores) {
    if (!Number.isInteger(a) || !Number.isInteger(b) || a < 0 || b < 0 || a > 999 || b > 999) return 'Scores must be whole numbers between 0 and 999.';
    if (a === b) return 'Individual volleyball sets cannot end tied.';
    if (Math.max(a, b) < points) return `Winning score must be at least ${points}.`;
    if (winByTwo && Math.abs(a - b) < 2) return 'The winning team must lead by at least two points.';
    if (winByTwo && Math.max(a, b) > points && Math.abs(a - b) !== 2) return 'An extended set must finish when a two-point lead is reached.';
    if (!winByTwo && Math.max(a, b) !== points) return `Without win-by-two, the winning score must equal ${points}.`;
  }
  return null;
}
