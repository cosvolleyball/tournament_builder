/** Qualification selection must be deterministic and must not assign
 * unqualified teams or duplicate a participant between brackets. */
import { describe, expect, it } from 'vitest';
import { createBundle } from './engine';
import { qualifiedTeamIds, distributeQualifiers, validateAssignments } from './playoffs';
import type { NewTournamentInput } from './types';

const make = (count: number, poolCount: number, twoBrackets=false) => {
  const input: NewTournamentInput = {
    name:'Qualification smoke test',sport:'Volleyball',startsOn:'2026-10-26',
    teamNames:Array.from({length:count},(_,i)=>`Team ${i+1}`),
    poolCount,poolSets:1,targetPoints:21,winByTwo:true,pointCap:25,
    seedMode:'snake',playoffBrackets:twoBrackets
      ? [{name:'Gold',format:'double',bracketReset:true},{name:'Silver',format:'single',bracketReset:false}]
      : [{name:'Championship',format:'double',bracketReset:true}],
  };
  return createBundle(input);
};

describe('playoff qualification',()=>{
  it('selects top two per pool and best two third-place wildcards (5/5/4 field)',()=>{
    const b=make(14,3);
    const selected=qualifiedTeamIds(b,{mode:'per_pool',topPerPool:2,nextPlaceWildcards:2,overallCount:8});
    expect(selected).toHaveLength(8);
    expect(new Set(selected).size).toBe(8);
    for (const pool of b.pools) {
      const members=b.poolTeams.filter(entry=>entry.pool_id===pool.id).map(entry=>entry.team_id);
      // Each pool contributes at least its two highest-ranked teams.
      const poolSelected=members.filter(id=>selected.includes(id));
      expect(poolSelected.length).toBeGreaterThanOrEqual(2);
      expect(poolSelected.length).toBeLessThanOrEqual(3);
    }
    const assignment=distributeQualifiers(b,selected);
    expect(validateAssignments(b,assignment)).toBeNull();
    expect(assignment[b.divisions[0].id]).toHaveLength(8);
  });

  it('allows a fixed best-overall cutoff and deliberately excludes teams',()=>{
    const b=make(16,4);
    const selected=qualifiedTeamIds(b,{mode:'overall',topPerPool:2,nextPlaceWildcards:0,overallCount:8});
    expect(selected).toHaveLength(8);
    expect(validateAssignments(b,distributeQualifiers(b,selected))).toBeNull();
  });

  it('splits only advancing teams among multiple brackets without duplication',()=>{
    const b=make(16,4,true);
    const selected=qualifiedTeamIds(b,{mode:'per_pool',topPerPool:2,nextPlaceWildcards:0,overallCount:0});
    const assignments=distributeQualifiers(b,selected);
    expect(Object.values(assignments).map(v=>v.length)).toEqual([4,4]);
    expect(new Set(Object.values(assignments).flat()).size).toBe(8);
    expect(validateAssignments(b,assignments)).toBeNull();
  });

  it('rejects duplicate or unknown participants but not intentionally excluded teams',()=>{
    const b=make(10,2,true);
    const ids=b.teams.slice(0,6).map(t=>t.id);
    const assignments=distributeQualifiers(b,ids);
    expect(validateAssignments(b,assignments)).toBeNull();
    assignments[b.divisions[1].id][0]=assignments[b.divisions[0].id][0];
    expect(validateAssignments(b,assignments)).not.toBeNull();
  });
});


describe('no-first-round-byes qualification', () => {
  it('recognizes full bracket sizes only', async () => {
    const { isByeFreeSize } = await import('./playoffs');
    expect([2,4,8,16,32,64].every(isByeFreeSize)).toBe(true);
    expect([0,1,3,5,6,7,10,14,65].some(isByeFreeSize)).toBe(false);
  });
  it('fills 6 automatic qualifiers with 2 third-place wildcards for 8 slots', async () => {
    const { suggestedByeFreeWildcards } = await import('./playoffs');
    const bundle = make(14, 3);
    const suggestion = suggestedByeFreeWildcards(bundle,2);
    expect(suggestion).toMatchObject({count:2,target:8,available:3,possible:true});
  });
});
