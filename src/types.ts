export type TournamentStatus = 'draft' | 'published' | 'pool_play' | 'pool_finalized' | 'playoffs' | 'completed';
export type SeedMode = 'snake' | 'random';
export type DivisionFormat = 'single' | 'double';
export interface Tournament {
  id: string; owner_id: string | null; name: string; sport: string; starts_on: string | null;
  status: TournamentStatus; pool_count: number; pool_sets: 1 | 2; target_points: number;
  win_by_two: boolean; seed_mode: SeedMode; created_at: string;
}
export interface Team { id: string; tournament_id: string; name: string; seed: number; }
export interface Pool { id: string; tournament_id: string; label: string; sort_order: number; }
export interface PoolTeam { tournament_id: string; pool_id: string; team_id: string; }
export interface Match {
  id: string; tournament_id: string; pool_id: string; team_a_id: string; team_b_id: string;
  round_number: number; sequence: number; status: 'scheduled' | 'completed';
}
export interface SetScore { match_id: string; set_number: number; score_a: number; score_b: number; }
export interface Division {
  id: string; tournament_id: string; name: string; format: DivisionFormat;
  bracket_reset: boolean; sort_order: number;
}
export interface TournamentBundle {
  tournament: Tournament; teams: Team[]; pools: Pool[]; poolTeams: PoolTeam[];
  matches: Match[]; scores: SetScore[]; divisions: Division[];
}
/** One planned playoff bracket within a competition division (not a sport/skill division). */
export interface PlannedBracket {
  name: string;
  format: DivisionFormat;
  bracketReset: boolean;
}

export interface NewTournamentInput {
  name: string; sport: string; startsOn: string; teamNames: string[]; poolCount: number;
  poolSets: 1 | 2; targetPoints: number; winByTwo: boolean; seedMode: SeedMode;
  playoffBrackets: PlannedBracket[];
}
