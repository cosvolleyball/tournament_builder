import {describe, expect, it} from 'vitest';
import {createBundle, standingsForPool} from './engine';
import {qualifiedTeamIds, suggestedByeFreeWildcards, isByeFreeSize, rankedPoolTeams} from './playoffs';
import type {TournamentBundle, NewTournamentInput} from './types';

function make(count:number, poolCount:number, sets:1|2=1):TournamentBundle {
  const input:NewTournamentInput={
    name:'Wildcard regression fixture',sport:'Volleyball',startsOn:'2026-11-14',
    teamNames:Array.from({length:count},(_,i)=>`Team ${i+1}`),
    poolCount,poolSets:sets,targetPoints:21,winByTwo:true,pointCap:null,
    seedMode:'snake',playoffBrackets:[{name:'Championship',format:'double',bracketReset:true}],
  };
  return createBundle(input);
}

function finish(b:TournamentBundle,winnerId:string,loserId:string,winnerScore:number,loserScore:number) {
  const match=b.matches.find(m=>(m.team_a_id===winnerId && m.team_b_id===loserId)
    || (m.team_b_id===winnerId && m.team_a_id===loserId));
  if(!match)throw Error('Expected round-robin match is missing');
  match.status='completed';
  b.scores.push({match_id:match.id,set_number:1,
    score_a:match.team_a_id===winnerId?winnerScore:loserScore,
    score_b:match.team_b_id===winnerId?winnerScore:loserScore});
}

function poolIds(b:TournamentBundle, idx:number):string[] {
  return b.poolTeams.filter(r=>r.pool_id===b.pools[idx].id)
    .map(row=>row.team_id)
    .sort((a,c)=>(b.teams.find(t=>t.id===a)!.seed-b.teams.find(t=>t.id===c)!.seed));
}

describe('wildcard selection with completed realistic results',()=>{
  it('uses normalized win percentage rather than raw victories across 5/5/4 pools',()=>{
    const b=make(14,3);
    const sizes=b.pools.map(pool=>b.poolTeams.filter(p=>p.pool_id===pool.id).length);
    expect(sizes).toEqual([5,5,4]);
    const seed=new Map(b.teams.map(t=>[t.id,t.seed]));
    for(const m of b.matches){
      const winner=seed.get(m.team_a_id)!<seed.get(m.team_b_id)!?m.team_a_id:m.team_b_id;
      const loser=winner===m.team_a_id?m.team_b_id:m.team_a_id;
      finish(b,winner,loser,21,15);
    }
    const third=b.pools.map(pool=>standingsForPool(b,pool.id)[2]);
    expect(third.map(r=>r.winPct)).toEqual([0.5,0.5,1/3]);
    const chosen=qualifiedTeamIds(b,{mode:'per_pool',topPerPool:2,nextPlaceWildcards:2,overallCount:8});
    expect(chosen).toHaveLength(8);
    expect(chosen).toContain(third[0].team.id);
    expect(chosen).toContain(third[1].team.id);
    expect(chosen).not.toContain(third[2].team.id);
    expect(suggestedByeFreeWildcards(b,2)).toMatchObject({count:2,target:8,possible:true});
    expect(isByeFreeSize(chosen.length)).toBe(true);
  });

  it('uses point ratio to break equal-percentage wildcard ties',()=>{
    const b=make(6,2);
    const [a,c,d]=poolIds(b,0);
    const [e,f,g]=poolIds(b,1);
    // Each three-team pool produces a 1-1 tie among all members.
    finish(b,a,c,21,5);finish(b,c,d,21,19);finish(b,d,a,21,19);
    finish(b,e,f,21,20);finish(b,f,g,21,5);finish(b,g,e,21,19);
    const first=standingsForPool(b,b.pools[0].id);
    const second=standingsForPool(b,b.pools[1].id);
    expect(first.map(x=>x.team.id)).toEqual([a,d,c]);
    expect(second.map(x=>x.team.id)).toEqual([f,e,g]);
    expect(first[1].winPct).toBe(second[1].winPct);
    expect(first[1].pointRatio).toBeGreaterThan(second[1].pointRatio);
    const selected=qualifiedTeamIds(b,{mode:'per_pool',topPerPool:1,nextPlaceWildcards:1,overallCount:0});
    expect(selected).toHaveLength(3);
    expect(selected).toContain(d);
    expect(selected).not.toContain(e);
  });

  it('honors two-team head-to-head ties within a pool despite opposite point ratios',()=>{
    const b=make(4,1);
    const [a,c,d,e]=poolIds(b,0);
    finish(b,a,d,21,0);finish(b,a,e,21,0);
    finish(b,c,a,21,19);finish(b,c,d,21,19);
    finish(b,e,c,21,0);finish(b,d,e,21,19);
    const standings=standingsForPool(b,b.pools[0].id);
    const recordA=standings.find(x=>x.team.id===a)!;
    const recordB=standings.find(x=>x.team.id===c)!;
    expect(recordA.winPct).toBe(recordB.winPct);
    expect(recordA.pointRatio).toBeGreaterThan(recordB.pointRatio);
    expect(standings[0].team.id).toBe(c); // head-to-head beats ratio in a two-way tie
    expect(rankedPoolTeams(b)[0]).toBe(c);
  });

  it('uses deterministic seeding when all two-set round robins finish 1-1 with identical points',()=>{
    const b=make(14,3,2);
    for(const match of b.matches){
      match.status='completed';
      b.scores.push({match_id:match.id,set_number:1,score_a:21,score_b:19});
      b.scores.push({match_id:match.id,set_number:2,score_a:19,score_b:21});
    }
    for(const pool of b.pools){
      const standings=standingsForPool(b,pool.id);
      expect(standings.every(r=>r.winPct===.5 && r.pointRatio===1 && r.avgDiff===0)).toBe(true);
      expect(standings.map(r=>r.team.seed)).toEqual([...standings.map(r=>r.team.seed)].sort((a,c)=>a-c));
    }
    const candidates=b.pools.map(pool=>standingsForPool(b,pool.id)[2].team);
    const expected=[...candidates].sort((a,c)=>a.seed-c.seed).slice(0,2).map(t=>t.id);
    const result=qualifiedTeamIds(b,{mode:'per_pool',topPerPool:2,nextPlaceWildcards:2,overallCount:8});
    expect(expected.every(id=>result.includes(id))).toBe(true);
    expect(result).toHaveLength(8);
  });

  it('reports when next-place wildcards cannot fill a no-bye bracket',()=>{
    const b=make(14,3);
    // Nine automatic entrants need a 16-team field, but only three next-place
    // candidates are available (one from each of the 5/5/4 pools).
    expect(suggestedByeFreeWildcards(b,3)).toMatchObject({count:7,target:16,available:3,possible:false});
  });
});
