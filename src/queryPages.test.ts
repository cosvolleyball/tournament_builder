import { describe, expect, it } from 'vitest';
import { readAllPages, readScoresByMatchIds } from './queryPages';

/** Supabase's default API maximum is 1,000 rows per response. */
const CAP = 1000;

describe('paginated tournament queries', () => {
  it('reads all 2,016 pool matches rather than stopping at the first 1,000', async () => {
    const source = Array.from({length: 2016}, (_, id) => ({id}));
    const calls: number[] = [];
    const rows = await readAllPages(async (start, end) => {
      calls.push(start);
      return {data: source.slice(start, Math.min(end+1, start+CAP)), error: null};
    });
    expect(rows).toEqual(source);
    expect(calls).toEqual([0,500,1000,1500,2000]);
  });

  it('reads 1,056 set scores for a 33-team two-set pool with short match-ID filters', async () => {
    const ids = Array.from({length: 528}, (_, i) => `match-${i}`);
    const source = ids.flatMap(match_id => [1,2].map(set_number => ({match_id,set_number})));
    const sizes: number[] = [];
    const rows = await readScoresByMatchIds(ids, async (chunk, start, end) => {
      sizes.push(chunk.length);
      const selected = source.filter(row => chunk.includes(row.match_id));
      return {data: selected.slice(start, Math.min(end+1,start+CAP)), error: null};
    });
    expect(rows).toEqual(source);
    expect(rows).toHaveLength(1056);
    expect(Math.max(...sizes)).toBeLessThanOrEqual(100);
  });

  it('supports 64 teams / 4,032 scores without duplicated or skipped records', async () => {
    const ids=Array.from({length:2016},(_,i)=>`match-${i}`);
    const rows=await readScoresByMatchIds(ids, async (chunk,start,end) => {
      const subset=chunk.flatMap(match_id=>[1,2].map(set_number=>({match_id,set_number})));
      return {data:subset.slice(start,end+1),error:null};
    });
    expect(rows).toHaveLength(4032);
    expect(new Set(rows.map(r=>`${r.match_id}:${r.set_number}`)).size).toBe(4032);
  });

  it('does not query scores when no matches exist', async () => {
    let calls=0;
    const rows=await readScoresByMatchIds([], async () => {
      calls++;
      return {data:[],error:null};
    });
    expect(rows).toEqual([]);
    expect(calls).toBe(0);
  });

  it('propagates a real database error instead of returning partial results', async () => {
    await expect(readAllPages(async () => ({data:null,error:{message:'permission denied'}})))
      .rejects.toThrow('permission denied');
  });
});
