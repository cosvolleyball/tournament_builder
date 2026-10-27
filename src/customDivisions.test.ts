/** Pure-data tests for independently configured, freely named divisions.
 * Server-side isolation is verified separately by the integration checklist.
 */
import { describe, expect, it } from 'vitest';
import { createBundle, scoringForPool } from './engine';
import type { NewTournamentInput } from './types';

const input: NewTournamentInput = {
  name: 'Fall Open', divisionName: 'Coed BB', sport: 'Volleyball', startsOn: '2026-11-05',
  teamNames: ['Eagles', 'Bears', 'Owls', 'Foxes'], poolCount: 2,
  poolSets: 1, targetPoints: 21, pointCap: 25, winByTwo: true,
  seedMode: 'snake', playoffBrackets: [
    { name: 'Championship', format: 'double', bracketReset: true },
  ],
};

describe('custom competition divisions', () => {
  it('accepts arbitrary division names, not just genders', () => {
    for (const name of ["Men's A", 'Open A/BB', 'Coed Intermediate', 'Recreational']) {
      const b = createBundle({ ...input, divisionName: name });
      expect(b.competitionDivisionName).toBe(name);
    }
  });

  it('keeps separate team, pool, match, and bracket IDs for sibling divisions', () => {
    const a = createBundle({ ...input, divisionName: 'Division A' });
    const b = createBundle({ ...input, divisionName: 'Division B', targetPoints: 25, pointCap: 29 });
    for (const key of ['teams','pools','poolTeams','matches','divisions'] as const) {
      expect(a[key]).toHaveLength(b[key].length);
    }
    expect(a.teams[0].id).not.toBe(b.teams[0].id);
    expect(a.pools[0].id).not.toBe(b.pools[0].id);
    expect(a.matches[0].id).not.toBe(b.matches[0].id);
    expect(a.divisions[0].id).not.toBe(b.divisions[0].id);
    expect(scoringForPool(a,a.pools[0].id).targetPoints).toBe(21);
    expect(scoringForPool(b,b.pools[0].id).targetPoints).toBe(25);
    expect(scoringForPool(a,a.pools[0].id).pointCap).toBe(25);
    expect(scoringForPool(b,b.pools[0].id).pointCap).toBe(29);
  });

  it('rejects empty custom division names', () => {
    expect(() => createBundle({ ...input, divisionName: '  ' })).toThrow(/division name/i);
  });
});
