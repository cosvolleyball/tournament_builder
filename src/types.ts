export type TournamentStatus = 'draft' | 'published' | 'pool_play' | 'pool_finalized' | 'playoffs' | 'completed';
export type SeedMode = 'snake' | 'random';
export type DivisionFormat = 'single' | 'double';
export interface Tournament {
  id: string; owner_id: string | null; name: string; sport: string; starts_on: string | null;
  status: TournamentStatus; pool_count: number; pool_sets: 1 | 2; target_points: number;
  win_by_two: boolean; point_cap?: number | null; seed_mode: SeedMode; created_at: string;
}
export interface Team { id: string; tournament_id: string; name: string; seed: number; }
/** A pool inherits the competition division's rules unless override is true. */
export interface Pool {
  id: string; tournament_id: string; label: string; sort_order: number;
  scoring_override?: boolean;
  target_points?: number | null;
  win_by_two?: boolean | null;
  point_cap?: number | null;
}
export interface ScoringRules {
  targetPoints: number;
  winByTwo: boolean;
  pointCap: number | null;
}
export interface PoolScoringOverride extends ScoringRules {
  enabled: boolean;
}
export interface PoolTeam { tournament_id: string; pool_id: string; team_id: string; }
export interface Match {
  id: string; tournament_id: string; pool_id: string; team_a_id: string; team_b_id: string;
  round_number: number; sequence: number; status: 'scheduled' | 'completed';
}
export interface SetScore { match_id: string; set_number: number; score_a: number; score_b: number; }
export interface Division {
  id: string; tournament_id: string; name: string; format: DivisionFormat;
  bracket_reset: boolean; sort_order: number; status?: 'draft' | 'ready' | 'active' | 'completed';
}
export interface TournamentBundle {
  tournament: Tournament; teams: Team[]; pools: Pool[]; poolTeams: PoolTeam[];
  matches: Match[]; scores: SetScore[]; divisions: Division[];
  playoffMatches?: PlayoffMatch[]; playoffScores?: SetScore[]; roundRules?: PlayoffRoundRule[];
}
/** One planned playoff bracket within a competition division (not a sport/skill division). */
export interface PlannedBracket {
  name: string;
  format: DivisionFormat;
  bracketReset: boolean;
}

export interface NewTournamentInput {
  name: string; sport: string; startsOn: string; teamNames: string[]; poolCount: number;
  poolSets: 1 | 2; targetPoints: number; winByTwo: boolean; pointCap?: number | null;
  poolScoring?: PoolScoringOverride[]; seedMode: SeedMode;
  playoffBrackets: PlannedBracket[];
}

/** One playoff match, independent of a pool matchup. */
export interface PlayoffMatch {
  id: string;
  tournament_id: string;
  division_id: string;
  bracket_id: string;
  team_a_id: string | null;
  team_b_id: string | null;
  round_number: number;
  sequence: number;
  status: 'scheduled' | 'completed' | 'bye' | 'forfeit';
}
/** A completed single-set match's score uses the existing set_scores table. */
export type BracketAssignments = Record<string, string[]>;

/** Persisted scoring settings for a single round of one playoff bracket. */
export interface PlayoffRoundRule {
  bracket_id: string;
  round_number: number;
  best_of: 1 | 3 | 5;
  target_points: number;
  win_by_two: boolean;
  point_cap: number | null;
  decider_target_points: number;
  decider_win_by_two: boolean;
  decider_point_cap: number | null;
}
export type RoundRulesByBracket = Record<string, PlayoffRoundRule[]>;
