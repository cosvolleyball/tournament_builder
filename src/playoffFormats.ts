/**
 * Playoff match-series scoring rules. Shared by review, public score entry,
 * and organizer corrections. Supabase independently revalidates every score.
 */
import type { PlayoffRoundRule, SetScore, TournamentBundle, Tournament } from './types';
import { scoreError, validateScoringRules } from './engine';

export type SeriesResult = { winner: 'a' | 'b'; winsA: number; winsB: number };

/** Existing tournaments without round rules retain their old one-set behavior. */
export function defaultRoundRule(bracketId: string, roundNumber: number, tournament: Tournament): PlayoffRoundRule {
  return {
    bracket_id: bracketId, round_number: roundNumber, best_of: 1,
    target_points: tournament.target_points, win_by_two: tournament.win_by_two,
    point_cap: tournament.point_cap ?? null,
    decider_target_points: 15, decider_win_by_two: true, decider_point_cap: null,
  };
}

export function effectiveRoundRule(bundle: TournamentBundle, bracketId: string, roundNumber: number): PlayoffRoundRule {
  return bundle.roundRules?.find(rule => rule.bracket_id===bracketId && rule.round_number===roundNumber)
    ?? defaultRoundRule(bracketId, roundNumber, bundle.tournament);
}

/** Validate rule inputs before sending them to the database. */
export function roundRuleError(rule: PlayoffRoundRule): string | null {
  if (![1,3,5].includes(rule.best_of)) return 'Choose one set, best of three, or best of five.';
  try {
    validateScoringRules({targetPoints:rule.target_points, winByTwo:rule.win_by_two,pointCap:rule.point_cap});
    validateScoringRules({targetPoints:rule.decider_target_points,winByTwo:rule.decider_win_by_two,pointCap:rule.decider_point_cap});
    return null;
  } catch (e) { return e instanceof Error ? e.message : String(e); }
}

/**
 * A match is complete as soon as either side reaches the required set wins.
 * There must be no missing set, ties, or extra sets after clinching the series.
 */
export function evaluateSeries(pairs: Array<[number,number]>, rule: PlayoffRoundRule): {result?: SeriesResult; error?: string} {
  const configError=roundRuleError(rule);
  if (configError) return {error:configError};
  const needed=Math.floor(rule.best_of/2)+1;
  if (pairs.length<needed || pairs.length>rule.best_of) return {error:`Enter ${needed}–${rule.best_of} completed sets.`};
  let winsA=0, winsB=0;
  for (let i=0;i<pairs.length;i++) {
    const deciding=i===rule.best_of-1 && rule.best_of>1;
    const target=deciding?rule.decider_target_points:rule.target_points;
    const winTwo=deciding?rule.decider_win_by_two:rule.win_by_two;
    const cap=deciding?rule.decider_point_cap:rule.point_cap;
    const err=scoreError([pairs[i]],1,target,winTwo,cap);
    if (err) return {error:`Set ${i+1}: ${err}`};
    if (pairs[i][0]>pairs[i][1]) winsA++; else winsB++;
    if ((winsA===needed || winsB===needed) && i!==pairs.length-1)
      return {error:'Remove extra sets after the match was already decided.'};
  }
  if (winsA<needed && winsB<needed) return {error:`Enter another set; neither team has won ${needed} yet.`};
  return {result:{winner:winsA===needed?'a':'b',winsA,winsB}};
}

export function scorePairs(scores:SetScore[]): Array<[number,number]> {
  return [...scores].sort((a,b)=>a.set_number-b.set_number).map(s=>[s.score_a,s.score_b]);
}
