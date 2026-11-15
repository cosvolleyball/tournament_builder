// Prepare a rollback SQL fixture, then check its returned JSON with the actual TS engine.
// node tests/integration/wildcard-parity.mjs prepare /tmp/tb-wildcard
// Run /tmp/tb-wildcard.sql via the database connector, save the returned `result` object
// as /tmp/tb-wildcard-result.json, then run `check /tmp/tb-wildcard`.
import fs from 'node:fs';
import assert from 'node:assert/strict';
import ts from 'typescript';
import {randomUUID} from 'node:crypto';
const [mode,prefix]=process.argv.slice(2);
assert.ok(prefix);
const compile=file=>ts.transpileModule(fs.readFileSync(file,'utf8'),{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.ES2022}}).outputText;
const url=code=>'data:text/javascript;base64,'+Buffer.from(code).toString('base64');
const engineURL=url(compile('src/engine.ts'));
const engine=await import(engineURL);
const playoffs=await import(url(compile('src/playoffs.ts').replace("'./engine'",JSON.stringify(engineURL))));
if(mode==='prepare') {
 const bundle=engine.createBundle({name:'QA rollback wildcard',sport:'Volleyball',startsOn:'2026-11-15',teamNames:Array.from({length:14},(_,i)=>`Team ${i+1}`),poolCount:3,poolSets:1,targetPoints:21,winByTwo:true,pointCap:null,seedMode:'snake',playoffBrackets:[{name:'Gold',format:'double',bracketReset:true}]});
 const owner=randomUUID(),division=randomUUID();
 const seed=new Map(bundle.teams.map(t=>[t.id,t.seed]));
 const scores=bundle.matches.map(m=>({match_id:m.id,set_number:1,score_a:seed.get(m.team_a_id)<seed.get(m.team_b_id)?21:10,score_b:seed.get(m.team_a_id)<seed.get(m.team_b_id)?10:21}));
 const quote=v=>v===null?'null':typeof v==='number'?String(v):typeof v==='boolean'?String(v):"'"+String(v).replaceAll("'","''")+"'";
 const insert=(table,rows)=>`INSERT INTO public.${table}(${Object.keys(rows[0]).join(',')}) VALUES ${rows.map(r=>'('+Object.values(r).map(quote).join(',')+')').join(',')};`;
 let sql=`BEGIN; SET LOCAL statement_timeout='30s';\nINSERT INTO auth.users(id,aud,role) VALUES('${owner}','authenticated','authenticated');\nSET LOCAL ROLE authenticated; SELECT set_config('request.jwt.claims','{"sub":"${owner}","role":"authenticated"}',true);\n`;
 sql+=insert('tournaments',[{id:bundle.tournament.id,owner_id:owner,name:bundle.tournament.name,status:'pool_play'}]);
 sql+=insert('competition_divisions',[{id:division,tournament_id:bundle.tournament.id,name:'Wildcard 5-5-4',sort_order:0,pool_count:3,pool_sets:1,status:'pool_play'}]);
 sql+=insert('teams',bundle.teams.map(r=>({...r,division_id:division})));
 sql+=insert('pools',bundle.pools.map(r=>({...r,division_id:division})));
 sql+=insert('pool_teams',bundle.poolTeams.map(r=>({...r,division_id:division})));
 sql+=insert('playoff_brackets',bundle.divisions.map(r=>({...r,division_id:division})));
 sql+=insert('matches',bundle.matches.map(r=>({...r,division_id:division})));
 sql+=`RESET ROLE; SET LOCAL ROLE anon; SELECT set_config('request.jwt.claims','{"role":"anon"}',true);\n`;
 for(const {match_id,...s} of scores)sql+=`SELECT public.submit_public_pool_result('${match_id}','${JSON.stringify([s])}');\n`;
 // The independent expected qualifier membership is seeds 1..8, across 5/5/4 pools.
 const expected=bundle.teams.filter(t=>t.seed<=8).map(t=>t.id);
 const bracket=bundle.divisions[0].id;
 const rules=Array.from({length:5},(_,i)=>({round_number:i+1,best_of:1,target_points:21,win_by_two:true,point_cap:null,decider_target_points:15,decider_win_by_two:true,decider_point_cap:null}));
 sql+=`RESET ROLE; SET LOCAL ROLE authenticated; SELECT set_config('request.jwt.claims','{"sub":"${owner}","role":"authenticated"}',true);\nSELECT public.finalize_one_competition_division('${bundle.tournament.id}','${division}','${JSON.stringify({[bracket]:expected})}','${JSON.stringify({[bracket]:rules})}',true);\n`;
 sql+=`SELECT jsonb_build_object('scores',(SELECT jsonb_agg(to_jsonb(s)) FROM public.set_scores s JOIN public.matches m ON m.id=s.match_id WHERE m.division_id='${division}' AND m.stage='pool'),'matches',(SELECT jsonb_agg(to_jsonb(m)) FROM public.matches m WHERE m.division_id='${division}' AND m.stage='pool'),'first_round',(SELECT jsonb_agg(to_jsonb(m)) FROM public.matches m WHERE m.bracket_id='${bracket}' AND m.playoff_phase='upper' AND m.round_number=1)) AS result; ROLLBACK;`;
 fs.writeFileSync(prefix+'.sql',sql);fs.writeFileSync(prefix+'.json',JSON.stringify(bundle));
 console.log(JSON.stringify({poolSizes:bundle.pools.map(p=>bundle.poolTeams.filter(t=>t.pool_id===p.id).length),matches:scores.length}));
} else {
 assert.equal(mode,'check');
 const bundle=JSON.parse(fs.readFileSync(prefix+'.json'));
 const result=JSON.parse(fs.readFileSync(prefix+'-result.json'));
 bundle.scores=result.scores;bundle.matches=result.matches;
 const thirds=bundle.pools.map(p=>engine.standingsForPool(bundle,p.id)[2]);
 assert.deepEqual(thirds.map(r=>r.winPct),[.5,.5,1/3]);
 const selected=playoffs.qualifiedTeamIds(bundle,{mode:'per_pool',topPerPool:2,nextPlaceWildcards:2,overallCount:8});
 const seeds=new Map(bundle.teams.map(t=>[t.id,t.seed]));
 assert.deepEqual(selected.map(id=>seeds.get(id)).sort((a,b)=>a-b),[1,2,3,4,5,6,7,8]);
 assert.equal(result.first_round.length,4);
 assert.ok(result.first_round.every(m=>m.status==='scheduled'&&m.team_a_id&&m.team_b_id));
 assert.deepEqual(result.first_round.flatMap(m=>[seeds.get(m.team_a_id),seeds.get(m.team_b_id)]).sort((a,b)=>a-b),[1,2,3,4,5,6,7,8]);
 console.log(JSON.stringify({passed:true,poolSizes:[5,5,4],livePoolScores:bundle.scores.length,qualifiers:8,firstRoundByes:0}));
}
