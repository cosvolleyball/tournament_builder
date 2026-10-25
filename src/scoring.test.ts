/** Point-cap and per-pool scoring regression tests for Tournament Builder v0.7b. */
import { describe, it, expect } from 'vitest';
import { createBundle, scoringForPool, scoreError } from './engine';
import type { NewTournamentInput } from './types';

const input: NewTournamentInput = {
  name: 'Three-Pool Open', sport: 'Volleyball', startsOn: '2026-11-01',
  teamNames: Array.from({ length: 14 }, (_, i) => `Team ${i + 1}`),
  poolCount: 3, poolSets: 2, targetPoints: 21, winByTwo: true,
  pointCap: 25, seedMode: 'snake', playoffBrackets: [],
  poolScoring: [
    { enabled: false, targetPoints: 21, winByTwo: true, pointCap: 25 },
    { enabled: false, targetPoints: 21, winByTwo: true, pointCap: 25 },
    { enabled: true, targetPoints: 25, winByTwo: true, pointCap: 29 },
  ],
};

describe('point caps and pool rules', () => {
  it('supports 5/5/4 teams with pool C playing to 25', () => {
    const bundle = createBundle(input);
    const counts = bundle.pools.map(pool => bundle.poolTeams.filter(t => t.pool_id === pool.id).length);
    expect(counts).toEqual([5, 5, 4]);
    expect(scoringForPool(bundle, bundle.pools[0].id)).toEqual({targetPoints:21,winByTwo:true,pointCap:25});
    expect(scoringForPool(bundle, bundle.pools[2].id)).toEqual({targetPoints:25,winByTwo:true,pointCap:29});
  });

  it('allows a one-point win at the cap only', () => {
    expect(scoreError([[25,24]],1,21,true,25)).toBeNull();
    expect(scoreError([[24,23]],1,21,true,25)).not.toBeNull();
    expect(scoreError([[25,18]],1,21,true,25)).not.toBeNull();
    expect(scoreError([[26,24]],1,21,true,25)).not.toBeNull();
    expect(scoreError([[24,22]],1,21,true,25)).toBeNull();
    expect(scoreError([[25,23]],1,21,true,25)).toBeNull();
  });

  it('validates a custom-cap pool', () => {
    expect(scoreError([[29,28]],1,25,true,29)).toBeNull();
    expect(scoreError([[29,27]],1,25,true,29)).toBeNull();
    expect(scoreError([[29,24]],1,25,true,29)).not.toBeNull();
  });

  it('retains uncapped scoring for older tournaments', () => {
    const bundle = createBundle({...input,pointCap:null,poolScoring:[]});
    expect(scoringForPool(bundle,bundle.pools[2].id).pointCap).toBeNull();
    expect(scoreError([[31,29]],1,21,true,null)).toBeNull();
  });

  it('rejects nonsensical scoring configurations', () => {
    expect(() => createBundle({...input,pointCap:20})).toThrow();
    expect(() => createBundle({...input,pointCap:25,winByTwo:false})).toThrow();
    expect(() => createBundle({...input,poolScoring:[
      {enabled:true,targetPoints:25,winByTwo:true,pointCap:24},
    ]})).toThrow();
  });
});
