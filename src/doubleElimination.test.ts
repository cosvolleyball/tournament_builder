import { describe, it, expect } from 'vitest';
import { createBundle } from './engine';
import { suggestedAssignments, validateAssignments, playoffRoundCount } from './playoffs';
import type { NewTournamentInput } from './types';

const make = (count: number, format: 'single' | 'double'): NewTournamentInput => ({
  name: 'Double elimination fixture test', sport: 'Volleyball', startsOn: '2026-11-01',
  teamNames: Array.from({ length: count }, (_, i) => `Team ${i+1}`),
  poolCount: 1, poolSets: 1, targetPoints: 21, winByTwo: true,
  pointCap: null, seedMode: 'snake',
  playoffBrackets: [{ name: 'Championship', format, bracketReset: true }],
});

describe('v0.8b double-elimination field sizes', () => {
  it('supports 2–64 team brackets including odd sizes and byes', () => {
    for (const count of [2,3,4,5,6,7,8,12,14,16,24,32,48,64]) {
      const bundle=createBundle(make(count,'double'));
      expect(validateAssignments(bundle,suggestedAssignments(bundle))).toBeNull();
      expect(playoffRoundCount(count,'double')).toBe(Math.ceil(Math.log2(count))+2);
    }
  });
  it('supports up to 64 teams in single elimination as before', () => {
    for (const count of [3,5,8,16,64]) {
      const bundle=createBundle(make(count,'single'));
      expect(validateAssignments(bundle,suggestedAssignments(bundle))).toBeNull();
      expect(playoffRoundCount(count,'single')).toBe(Math.ceil(Math.log2(count)));
    }
  });
  it('rejects an invalid field size early', () => {
    expect(playoffRoundCount(1,'double')).toBe(0);
    expect(playoffRoundCount(65,'double')).toBe(0);
  });
});
