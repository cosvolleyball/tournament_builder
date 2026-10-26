import {describe,it,expect} from 'vitest';
import {evaluateSeries,defaultRoundRule} from './playoffFormats';
import type {Tournament} from './types';
const tournament={target_points:21,win_by_two:true,point_cap:25} as Tournament;
const make=(best_of:1|3|5)=>({...defaultRoundRule('bracket',1,tournament),best_of});
describe('per-round playoff match formats',()=>{
  it('still supports earlier single-set tournaments',()=>{
    expect(evaluateSeries([[21,19]],make(1)).result?.winner).toBe('a');
  });
  it('finishes best-of-three at two straight wins',()=>{
    expect(evaluateSeries([[21,19],[21,18]],make(3)).result).toEqual({winner:'a',winsA:2,winsB:0});
    expect(evaluateSeries([[21,19],[21,18],[21,17]],make(3)).error).toMatch(/extra sets/i);
  });
  it('uses the 15-point decider for a split best-of-three',()=>{
    expect(evaluateSeries([[21,19],[19,21],[15,13]],make(3)).result?.winner).toBe('a');
    expect(evaluateSeries([[21,19],[19,21],[14,13]],make(3)).error).toMatch(/set 3/i);
  });
  it('finishes best-of-five after 3–1 and supports 3–2',()=>{
    expect(evaluateSeries([[21,19],[19,21],[21,17],[21,18]],make(5)).result?.winner).toBe('a');
    expect(evaluateSeries([[21,19],[19,21],[21,17],[18,21],[13,15]],make(5)).result?.winner).toBe('b');
  });
  it('rejects unfinished series and tied sets',()=>{
    expect(evaluateSeries([[21,19],[19,21]],make(3)).error).toBeTruthy();
    expect(evaluateSeries([[21,21],[21,19]],make(3)).error).toBeTruthy();
  });
});
