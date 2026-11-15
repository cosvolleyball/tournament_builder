-- Production database permission and score-validation regressions.
-- Runs against disposable rows and rolls back EVERYTHING, including Auth fixtures.
BEGIN;
SET LOCAL statement_timeout='55s';
SET LOCAL lock_timeout='2s';
DO $test$
DECLARE
  a uuid:=gen_random_uuid(); b uuid:=gen_random_uuid(); t uuid:=gen_random_uuid();
  d uuid:=gen_random_uuid(); p uuid:=gen_random_uuid(); br uuid:=gen_random_uuid();
  x uuid:=gen_random_uuid(); y uuid:=gen_random_uuid(); pm uuid:=gen_random_uuid();
  m uuid; table_name text; predicate text; col text; cnt int; checks int:=0;
  rejected boolean; bad jsonb; rules jsonb; best int; valid jsonb; invalid jsonb;
  payloads jsonb[]:=ARRAY['null','{}','[]','[{}]',
    '[{"set_number":1,"score_a":null,"score_b":10}]',
    '[{"set_number":1,"score_a":"21","score_b":10}]',
    '[{"set_number":1,"score_a":21.5,"score_b":10}]',
    '[{"set_number":1,"score_a":-1,"score_b":21}]',
    '[{"set_number":1,"score_a":1000,"score_b":10}]',
    '[{"set_number":2,"score_a":21,"score_b":10}]',
    '[{"set_number":1,"score_a":21,"score_b":21}]',
    '[{"set_number":1,"score_a":20,"score_b":10}]',
    '[{"set_number":1,"score_a":21,"score_b":20}]']::jsonb[];
  good jsonb:='[{"set_number":1,"score_a":21,"score_b":10}]';
BEGIN
  INSERT INTO auth.users(id,aud,role) VALUES(a,'authenticated','authenticated'),(b,'authenticated','authenticated');
  PERFORM set_config('request.jwt.claims',jsonb_build_object('sub',a,'role','authenticated')::text,true);
  EXECUTE 'SET LOCAL ROLE authenticated';
  INSERT INTO public.tournaments(id,owner_id,name) VALUES(t,a,'QA rollback security');
  INSERT INTO public.competition_divisions(id,tournament_id,name,sort_order,pool_count,pool_sets)
    VALUES(d,t,'Custom Security',0,1,1);
  INSERT INTO public.teams(id,tournament_id,division_id,name,seed) VALUES(x,t,d,'A',1),(y,t,d,'B',2);
  INSERT INTO public.pools(id,tournament_id,division_id,label,sort_order) VALUES(p,t,d,'A',0);
  INSERT INTO public.pool_teams(tournament_id,division_id,pool_id,team_id) VALUES(t,d,p,x),(t,d,p,y);
  INSERT INTO public.playoff_brackets(id,tournament_id,division_id,name,format,sort_order) VALUES(br,t,d,'Final','single',0);
  INSERT INTO public.matches(id,tournament_id,division_id,pool_id,team_a_id,team_b_id,round_number,sequence)
    VALUES(pm,t,d,p,x,y,1,1);
  EXECUTE 'RESET ROLE';
  -- Give every read-only playoff table a draft fixture so SELECT tests are non-vacuous.
  INSERT INTO public.matches(id,tournament_id,division_id,bracket_id,stage,team_a_id,team_b_id,round_number,sequence)
    VALUES(gen_random_uuid(),t,d,br,'playoff',x,y,1,1) RETURNING id INTO m;
  INSERT INTO public.set_scores VALUES(pm,1,21,10);
  INSERT INTO public.playoff_match_links VALUES(t,d,br,pm,m,'a');
  INSERT INTO public.playoff_loser_links VALUES(t,d,br,pm,m,'b');
  INSERT INTO public.playoff_round_rules(tournament_id,division_id,bracket_id,round_number,target_points,win_by_two,decider_target_points,decider_win_by_two)
    VALUES(t,d,br,1,21,true,15,true);
  FOREACH table_name IN ARRAY ARRAY['tournaments','competition_divisions','teams','pools','pool_teams','matches','set_scores','playoff_brackets','playoff_match_links','playoff_loser_links','playoff_round_rules'] LOOP
    predicate:=CASE table_name WHEN 'tournaments' THEN format('id=%L',t) WHEN 'set_scores' THEN format('match_id=%L',pm) ELSE format('tournament_id=%L',t) END;
    EXECUTE format('SELECT count(*) FROM public.%I WHERE %s',table_name,predicate) INTO cnt;
    IF cnt=0 THEN RAISE EXCEPTION 'Empty fixture for %',table_name; END IF;
    EXECUTE 'SET LOCAL ROLE anon'; PERFORM set_config('request.jwt.claims','{"role":"anon"}',true);
    EXECUTE format('SELECT count(*) FROM public.%I WHERE %s',table_name,predicate) INTO cnt;
    IF cnt<>0 THEN RAISE EXCEPTION 'Anon reads draft %',table_name; END IF; checks:=checks+1;
    EXECUTE 'RESET ROLE'; EXECUTE 'SET LOCAL ROLE authenticated';
    PERFORM set_config('request.jwt.claims',jsonb_build_object('sub',b,'role','authenticated')::text,true);
    EXECUTE format('SELECT count(*) FROM public.%I WHERE %s',table_name,predicate) INTO cnt;
    IF cnt<>0 THEN RAISE EXCEPTION 'B reads A draft %',table_name; END IF; checks:=checks+1;
    EXECUTE 'RESET ROLE';
  END LOOP;
  DELETE FROM public.playoff_match_links WHERE tournament_id=t;
  DELETE FROM public.playoff_loser_links WHERE tournament_id=t;
  DELETE FROM public.playoff_round_rules WHERE tournament_id=t;
  DELETE FROM public.matches WHERE id=m;
  DELETE FROM public.set_scores WHERE match_id=pm;
  EXECUTE 'SET LOCAL ROLE authenticated';
  PERFORM set_config('request.jwt.claims',jsonb_build_object('sub',a,'role','authenticated')::text,true);
  rejected:=false;
  BEGIN UPDATE public.tournaments SET owner_id=b WHERE id=t; EXCEPTION WHEN insufficient_privilege THEN rejected:=true; END;
  IF NOT rejected THEN RAISE EXCEPTION 'Owner reassignment allowed'; END IF; checks:=checks+1;
  UPDATE public.tournaments SET status='pool_play' WHERE id=t;
  UPDATE public.competition_divisions SET status='pool_play' WHERE id=d;
  -- B's direct UPDATE and DELETE must affect zero rows (or deny permission).
  PERFORM set_config('request.jwt.claims',jsonb_build_object('sub',b,'role','authenticated')::text,true);
  FOREACH table_name IN ARRAY ARRAY['tournaments','competition_divisions','teams','pools','pool_teams','matches','playoff_brackets'] LOOP
    predicate:=CASE table_name WHEN 'tournaments' THEN format('id=%L',t) ELSE format('tournament_id=%L',t) END;
    col:=CASE table_name WHEN 'tournaments' THEN 'name' ELSE 'tournament_id' END;
    EXECUTE format('UPDATE public.%I SET %I=%I WHERE %s',table_name,col,col,predicate);
    GET DIAGNOSTICS cnt=ROW_COUNT;
    IF cnt<>0 THEN RAISE EXCEPTION 'B updates A %',table_name; END IF; checks:=checks+1;
    EXECUTE format('DELETE FROM public.%I WHERE %s',table_name,predicate);
    GET DIAGNOSTICS cnt=ROW_COUNT;
    IF cnt<>0 THEN RAISE EXCEPTION 'B deletes A %',table_name; END IF; checks:=checks+1;
  END LOOP;
  rejected:=false;
  BEGIN INSERT INTO public.teams(tournament_id,division_id,name,seed) VALUES(t,d,'Injection',3);
    EXCEPTION WHEN insufficient_privilege THEN rejected:=true; END;
  IF NOT rejected THEN RAISE EXCEPTION 'B inserts A team'; END IF; checks:=checks+1;
  rejected:=false;
  BEGIN INSERT INTO public.tournaments(owner_id,name) VALUES(a,'Spoofed owner'); EXCEPTION WHEN insufficient_privilege THEN rejected:=true; END;
  IF NOT rejected THEN RAISE EXCEPTION 'B impersonates A owner'; END IF; checks:=checks+1;
  EXECUTE 'RESET ROLE'; EXECUTE 'SET LOCAL ROLE anon'; PERFORM set_config('request.jwt.claims','{"role":"anon"}',true);
  FOREACH bad IN ARRAY payloads LOOP
    rejected:=false;
    BEGIN PERFORM public.submit_public_pool_result(pm,bad); EXCEPTION WHEN OTHERS THEN rejected:=true; END;
    IF NOT rejected THEN RAISE EXCEPTION 'Malformed pool payload accepted %',bad; END IF;
    IF EXISTS(SELECT 1 FROM public.set_scores WHERE match_id=pm) THEN RAISE EXCEPTION 'Partial pool scores committed'; END IF;
    checks:=checks+1;
  END LOOP;
  -- Pool override, two-set split, cap boundary and organizer corrections.
  EXECUTE 'RESET ROLE'; EXECUTE 'SET LOCAL ROLE authenticated';
  PERFORM set_config('request.jwt.claims',jsonb_build_object('sub',a,'role','authenticated')::text,true);
  UPDATE public.competition_divisions SET pool_sets=2 WHERE id=d;
  UPDATE public.pools SET scoring_override=true,target_points=25,win_by_two=true,point_cap=27 WHERE id=p;
  EXECUTE 'RESET ROLE'; EXECUTE 'SET LOCAL ROLE anon'; PERFORM set_config('request.jwt.claims','{"role":"anon"}',true);
  rejected:=false;
  BEGIN PERFORM public.submit_public_pool_result(pm,'[{"set_number":1,"score_a":21,"score_b":10},{"set_number":2,"score_a":10,"score_b":25}]');
    EXCEPTION WHEN raise_exception THEN rejected:=true; END;
  IF NOT rejected THEN RAISE EXCEPTION 'Pool override ignored'; END IF; checks:=checks+1;
  rejected:=false;
  BEGIN PERFORM public.submit_public_pool_result(pm,'[{"set_number":1,"score_a":25,"score_b":10},{"set_number":2,"score_a":26,"score_b":28}]');
    EXCEPTION WHEN raise_exception THEN rejected:=true; END;
  IF NOT rejected OR EXISTS(SELECT 1 FROM public.set_scores WHERE match_id=pm) THEN RAISE EXCEPTION 'Cap rejection not atomic'; END IF; checks:=checks+1;
  PERFORM public.submit_public_pool_result(pm,'[{"set_number":1,"score_a":27,"score_b":26},{"set_number":2,"score_a":10,"score_b":25}]'); checks:=checks+1;
  EXECUTE 'RESET ROLE'; EXECUTE 'SET LOCAL ROLE authenticated';
  PERFORM set_config('request.jwt.claims',jsonb_build_object('sub',a,'role','authenticated')::text,true);
  rules:='[{"round_number":1,"best_of":3,"target_points":21,"win_by_two":true,"point_cap":25,"decider_target_points":15,"decider_win_by_two":true,"decider_point_cap":17}]';
  PERFORM public.finalize_one_competition_division(t,d,jsonb_build_object(br,jsonb_build_array(x,y)),jsonb_build_object(br,rules),true);
  SELECT id INTO STRICT m FROM public.matches WHERE bracket_id=br;
  -- Both public playoff entry points reject draft tournaments even with active brackets.
  EXECUTE 'RESET ROLE'; UPDATE public.tournaments SET status='draft' WHERE id=t;
  EXECUTE 'SET LOCAL ROLE anon'; PERFORM set_config('request.jwt.claims','{"role":"anon"}',true);
  rejected:=false;
  BEGIN PERFORM public.submit_public_playoff_series(m,good); EXCEPTION WHEN raise_exception THEN rejected:=true; END;
  IF NOT rejected THEN RAISE EXCEPTION 'Draft series accepted'; END IF; checks:=checks+1;
  rejected:=false;
  BEGIN PERFORM public.submit_public_playoff_result(m,21,10); EXCEPTION WHEN raise_exception THEN rejected:=true; END;
  IF NOT rejected THEN RAISE EXCEPTION 'Draft legacy result accepted'; END IF; checks:=checks+1;
  EXECUTE 'RESET ROLE'; UPDATE public.tournaments SET status='playoffs' WHERE id=t;
  EXECUTE 'SET LOCAL ROLE anon'; PERFORM set_config('request.jwt.claims','{"role":"anon"}',true);
  FOREACH bad IN ARRAY payloads LOOP
    rejected:=false;
    BEGIN PERFORM public.submit_public_playoff_series(m,bad); EXCEPTION WHEN OTHERS THEN rejected:=true; END;
    IF NOT rejected OR EXISTS(SELECT 1 FROM public.set_scores WHERE match_id=m) THEN RAISE EXCEPTION 'Malformed playoff payload accepted %',bad; END IF;
    checks:=checks+1;
  END LOOP;
  -- Test best-of-1/3/5 with target, cap, deciding set, incomplete and extra sets.
  FOREACH best IN ARRAY ARRAY[1,3,5] LOOP
    EXECUTE 'RESET ROLE';
    UPDATE public.playoff_round_rules SET best_of=best WHERE bracket_id=br;
    EXECUTE 'SET LOCAL ROLE anon';
    valid:='[]';
    FOR cnt IN 1..best LOOP
      valid:=valid||jsonb_build_object('set_number',cnt,'score_a',CASE WHEN cnt=best THEN 17 WHEN cnt%2=1 THEN 25 ELSE 10 END,
        'score_b',CASE WHEN cnt=best THEN 16 WHEN cnt%2=1 THEN 24 ELSE 21 END);
    END LOOP;
    IF best=1 THEN valid:='[{"set_number":1,"score_a":25,"score_b":24}]'; END IF;
    invalid:=jsonb_set(valid,ARRAY[(best-1)::text,'score_a'],CASE WHEN best=1 THEN '26'::jsonb ELSE '18'::jsonb END);
    rejected:=false;
    BEGIN PERFORM public.submit_public_playoff_series(m,invalid); EXCEPTION WHEN raise_exception THEN rejected:=true; END;
    IF NOT rejected THEN RAISE EXCEPTION 'Cap exceeded best-of-%',best; END IF; checks:=checks+1;
    IF best>1 THEN
      rejected:=false;
      BEGIN PERFORM public.submit_public_playoff_series(m,valid-(best-1)); EXCEPTION WHEN raise_exception THEN rejected:=true; END;
      IF NOT rejected THEN RAISE EXCEPTION 'Incomplete series accepted'; END IF; checks:=checks+1;
      invalid:='[]';
      FOR cnt IN 1..best LOOP invalid:=invalid||jsonb_build_object('set_number',cnt,'score_a',21,'score_b',10); END LOOP;
      rejected:=false;
      BEGIN PERFORM public.submit_public_playoff_series(m,invalid); EXCEPTION WHEN raise_exception THEN rejected:=true; END;
      IF NOT rejected THEN RAISE EXCEPTION 'Extra sets accepted'; END IF; checks:=checks+1;
    END IF;
    -- Subtransaction deliberately rolls valid scores back to reuse the same fixture.
    BEGIN
      PERFORM public.submit_public_playoff_series(m,valid);
      IF (SELECT count(*) FROM public.set_scores WHERE match_id=m)<>best THEN RAISE EXCEPTION 'Valid series missing'; END IF;
      IF (SELECT status FROM public.playoff_brackets WHERE id=br)<>'completed' THEN RAISE EXCEPTION 'Single final did not complete'; END IF;
      RAISE EXCEPTION USING ERRCODE='ZX001',MESSAGE='rollback valid probe';
    EXCEPTION WHEN SQLSTATE 'ZX001' THEN NULL; END;
    checks:=checks+1;
  END LOOP;
  EXECUTE 'RESET ROLE';
  -- Every table must retain RLS; anonymous users have no direct writes.
  IF EXISTS(SELECT 1 FROM pg_class c JOIN pg_namespace ns ON ns.oid=c.relnamespace
    WHERE ns.nspname='public' AND c.relkind IN ('r','p') AND NOT c.relrowsecurity) THEN RAISE EXCEPTION 'Public table without RLS'; END IF;
  FOREACH table_name IN ARRAY ARRAY['tournaments','competition_divisions','teams','pools','pool_teams','matches','set_scores','playoff_brackets','playoff_match_links','playoff_loser_links','playoff_round_rules'] LOOP
    IF has_table_privilege('anon','public.'||table_name,'INSERT,UPDATE,DELETE,TRUNCATE') THEN RAISE EXCEPTION 'Anon direct write grant %',table_name; END IF;
    checks:=checks+1;
  END LOOP;
  IF has_function_privilege('anon','public.rls_auto_enable()','execute') OR has_function_privilege('authenticated','public.rls_auto_enable()','execute') THEN RAISE EXCEPTION 'Event trigger executable'; END IF;
  PERFORM set_config('qa.result',jsonb_build_object('passed',true,'checks',checks,'rolled_back',true)::text,true);
END $test$;
SELECT current_setting('qa.result')::jsonb AS results;
ROLLBACK;
