// Only use a manifest of disposable IDs created for this test, never real matches.
// API config: {url,key}; fixture: {tournament,division,bracket,match,owner,a,b}.
// Usage: node tests/integration/http-race.mjs config.json fixture.json pool|playoff
import fs from 'node:fs';
import assert from 'node:assert/strict';
const [configPath,fixturePath,stage]=process.argv.slice(2);
assert.ok(['pool','playoff'].includes(stage));
const config=JSON.parse(fs.readFileSync(configPath));
const fixture=JSON.parse(fs.readFileSync(fixturePath));
const headers={apikey:config.key,'content-type':'application/json'};
const root=`${config.url}/rest/v1`;
const response=await fetch(`${root}/tournaments?id=eq.${fixture.tournament}&select=name`,{headers});
assert.equal(response.status,200);
const [tournament]=await response.json();
assert.equal(tournament?.name,'[QA disposable] HTTP concurrency 2026-11-15');
let id=fixture.match;
if(stage==='playoff') {
 const r=await fetch(`${root}/matches?bracket_id=eq.${fixture.bracket}&select=id`,{headers});
 assert.equal(r.status,200); const matches=await r.json();assert.equal(matches.length,1);id=matches[0].id;
}
const rpc=stage==='pool'?'submit_public_pool_result':'submit_public_playoff_series';
const results=await Promise.all([[21,10],[10,21]].map(async([score_a,score_b])=>{
 const r=await fetch(`${root}/rpc/${rpc}`,{method:'POST',headers,body:JSON.stringify({p_match_id:id,p_scores:[{set_number:1,score_a,score_b}]})});
 return {status:r.status,body:await r.text(),score_a,score_b};
}));
assert.equal(results.filter(r=>r.status===204).length,1);
assert.equal(results.filter(r=>r.status===400).length,1);
const accepted=results.find(r=>r.status===204);
const read=await fetch(`${root}/set_scores?match_id=eq.${id}&select=set_number,score_a,score_b`,{headers});
assert.equal(read.status,200);
assert.deepEqual(await read.json(),[{set_number:1,score_a:accepted.score_a,score_b:accepted.score_b}]);
console.log(JSON.stringify({stage,statuses:results.map(r=>r.status),exactlyOneWinner:true,storedScoreMatchesWinner:true}));
