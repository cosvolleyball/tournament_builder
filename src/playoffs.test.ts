import { describe, it, expect } from 'vitest';
import { createBundle } from './engine';
import { previewSingleElimination, seedPositions, suggestedAssignments, validateAssignments } from './playoffs';
import type { NewTournamentInput } from './types';
const base: NewTournamentInput = {
  name: 'Test', sport: 'Volleyball', startsOn: '2026-11-01',
  teamNames: Array.from({ length: 16 }, (_, i) => `Team ${i+1}`),
  poolCount: 4, poolSets: 2, targetPoints: 21, winByTwo: true, seedMode: 'snake',
  playoffBrackets: [{ name: 'Gold', format: 'single', bracketReset: false }, { name: 'Silver', format: 'single', bracketReset: false }],
};
describe('single elimination', () => {
  it('uses standard seeds and grants byes to higher seeds', () => {
    expect(seedPositions(8)).toEqual([1, 8, 4, 5, 2, 7, 3, 6]);
    expect(seedPositions(5)).toEqual([1, 8, 4, 5, 2, 7, 3, 6]);
    const preview = previewSingleElimination(['a','b','c','d','e']);
    expect(preview).toHaveLength(7);
    expect(preview.filter(m => m.round === 1 && (!m.teamA || !m.teamB))).toHaveLength(3);
    expect(preview.filter(m => m.round === 1 && m.teamA && m.teamB)).toHaveLength(1);
  });
  it('supports brackets with 2,3,5,6,8,10,16 teams', () => {
    for (const n of [2,3,5,6,8,10,16]) {
      const ids = Array.from({length:n},(_,i)=>String(i));
      expect(previewSingleElimination(ids)).toHaveLength(seedPositions(n).length - 1);
    }
  });
  it('assigns Gold and Silver evenly, with no duplicated teams', () => {
    const b = createBundle(base);
    const assign = suggestedAssignments(b);
    expect(Object.values(assign).map(ids=>ids.length)).toEqual([8,8]);
    expect(validateAssignments(b, assign)).toBeNull();
    assign[b.divisions[0].id][0] = assign[b.divisions[1].id][0];
    expect(validateAssignments(b, assign)).not.toBeNull();
  });
  it('blocks double-elimination for this milestone, rather than misbuilding it',()=>{
    const b = createBundle({...base,playoffBrackets:[{name:'Gold',format:'double',bracketReset:true}]});
    expect(validateAssignments(b,suggestedAssignments(b))).toMatch(/Double-elimination/);
  });
});
