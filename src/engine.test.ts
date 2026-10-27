import { describe, expect, it } from 'vitest';
import { createBundle, roundRobin, scoreError, standingsForPool, assignPools } from './engine';
import type { NewTournamentInput } from './types';
const input: NewTournamentInput = {
  name:'Autumn Cup', sport:'Volleyball',startsOn:'2026-11-01',teamNames:Array.from({length:16},(_,i)=>`Team ${i+1}`),poolCount:4,
  poolSets:2,targetPoints:21,winByTwo:true,seedMode:'snake',
  playoffBrackets:[
    {name:'Gold',format:'double',bracketReset:true},
    {name:'Silver',format:'single',bracketReset:false},
  ],
};
describe('tournament engine',()=>{
  it('creates 4 evenly distributed pools and 24 unique matchups for 16 teams',()=>{
    const b=createBundle(input);
    expect(b.pools).toHaveLength(4);expect(b.matches).toHaveLength(24);
    for(const p of b.pools) expect(b.poolTeams.filter(x=>x.pool_id===p.id)).toHaveLength(4);
    for(const p of b.pools) {
      const keys=b.matches.filter(m=>m.pool_id===p.id).map(m=>[m.team_a_id,m.team_b_id].sort().join('~'));
      expect(new Set(keys).size).toBe(6);
    }
  });
  it('supports uneven pools without dropping any teams',()=>{
    const b=createBundle({...input,teamNames:input.teamNames.slice(0,10),poolCount:3});
    const poolSizes = b.pools.map(p=>b.poolTeams.filter(x=>x.pool_id===p.id).length);
    // Snake seeding may give any pool the extra team; only the distribution matters.
    expect([...poolSizes].sort((a, b) => b - a)).toEqual([4,3,3]);
    expect(poolSizes.reduce((sum, count) => sum + count, 0)).toBe(10);
    expect(b.matches).toHaveLength(12);
  });
  it('generates n(n-1)/2 matches for odd and even pool sizes',()=>{
    for (const n of [3,4,5,6]) {
      const matches=roundRobin(Array.from({length:n},(_,i)=>String(i)), 'p', 't');
      expect(matches).toHaveLength(n*(n-1)/2);
      expect(new Set(matches.map(m=>[m.team_a_id,m.team_b_id].sort().join('/'))).size).toBe(matches.length);
    }
  });
  it('seed snake moves back and forth',()=>{
    const order=assignPools('12345678'.split(''),['A','B'], 'snake');
    expect(order.map(x=>x.pool_id)).toEqual(['A','B','B','A','A','B','B','A']);
  });
  it('counts a split two-set match as one set win each',()=>{
    const b=createBundle({...input,teamNames:['Eagles','Wolves'],poolCount:1});
    const m=b.matches[0];m.status='completed';
    b.scores=[{match_id:m.id,set_number:1,score_a:21,score_b:17},{match_id:m.id,set_number:2,score_a:18,score_b:21}];
    const standings=standingsForPool(b,b.pools[0].id);
    expect(standings.map(s=>s.wins)).toEqual([1,1]);
    expect(standings.reduce((sum,s)=>sum+s.pointsFor,0)).toBe(77);
  });
  it('requires all scores, disallows tied sets and enforces win-by-two',()=>{
    expect(scoreError([[21,19],[19,21]],2,21,true)).toBeNull();
    expect(scoreError([[21,20]],1,21,true)).not.toBeNull();
    expect(scoreError([[21,21]],1,21,true)).not.toBeNull();
    expect(scoreError([[22,20]],1,21,true)).toBeNull();
  });
});
