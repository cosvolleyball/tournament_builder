-- Run as postgres against the CURRENT effective schema, never schema.sql alone.
-- Fixtures and synthetic Auth identities exist only within this transaction.
-- SET LOCAL ROLE exercises actual grants/RLS; this does not test JWT issuance/HTTP.
BEGIN;
SET LOCAL statement_timeout = '55s';
SET LOCAL lock_timeout = '2s';
DO $test$
DECLARE
  owner_a uuid := gen_random_uuid();
  owner_b uuid := gen_random_uuid();
  tid uuid; did uuid; other_did uuid; bid uuid; pid uuid;
  other_pool uuid; other_match uuid; other_a uuid; other_b uuid;
  ids uuid[]; mid uuid; first_mid uuid; first_a uuid; first_b uuid;
  m public.matches%rowtype; link record; team record;
  n int; mode int; i int; j int; k int; rounds int; slots int; played int;
  losses int; expected int; changed int; champion uuid; winner uuid; loser uuid;
  rules jsonb; scores jsonb; rejected boolean; results jsonb := '[]';
  good jsonb := '[{"set_number":1,"score_a":21,"score_b":10}]';
  reverse_score jsonb := '[{"set_number":1,"score_a":10,"score_b":21}]';
BEGIN
  INSERT INTO auth.users(id,aud,role) VALUES
    (owner_a,'authenticated','authenticated'),(owner_b,'authenticated','authenticated');
  FOREACH n IN ARRAY ARRAY[5,8,14,16] LOOP
    -- mode 0: no reset, lower champion wins; 1: reset; 2: undefeated champion.
    FOR mode IN 0..2 LOOP
      tid:=gen_random_uuid(); did:=gen_random_uuid(); other_did:=gen_random_uuid();
      bid:=gen_random_uuid(); pid:=gen_random_uuid(); ids:='{}'; first_mid:=null;
      PERFORM set_config('request.jwt.claims',jsonb_build_object('sub',owner_a,'role','authenticated')::text,true);
      EXECUTE 'SET LOCAL ROLE authenticated';
      INSERT INTO public.tournaments(id,owner_id,name) VALUES(tid,owner_a,'QA rollback integration');
      INSERT INTO public.competition_divisions(id,tournament_id,name,sort_order,pool_count,pool_sets)
        VALUES(did,tid,'Custom A',0,1,1),(other_did,tid,'Custom BB',1,1,1);
      INSERT INTO public.pools(id,tournament_id,division_id,label,sort_order) VALUES(pid,tid,did,'A',0);
      FOR i IN 1..n LOOP
        ids:=array_append(ids,gen_random_uuid());
        INSERT INTO public.teams(id,tournament_id,division_id,name,seed) VALUES(ids[i],tid,did,'Team '||i,i);
        INSERT INTO public.pool_teams(tournament_id,division_id,pool_id,team_id) VALUES(tid,did,pid,ids[i]);
      END LOOP;
      INSERT INTO public.playoff_brackets(id,tournament_id,division_id,name,format,bracket_reset,sort_order)
        VALUES(bid,tid,did,'Championship','double',mode<>0,0);
      other_pool:=gen_random_uuid(); other_match:=gen_random_uuid(); other_a:=gen_random_uuid(); other_b:=gen_random_uuid();
      INSERT INTO public.teams(id,tournament_id,division_id,name,seed) VALUES(other_a,tid,other_did,'BB 1',1),(other_b,tid,other_did,'BB 2',2);
      INSERT INTO public.pools(id,tournament_id,division_id,label,sort_order) VALUES(other_pool,tid,other_did,'BB',0);
      INSERT INTO public.pool_teams(tournament_id,division_id,pool_id,team_id) VALUES(tid,other_did,other_pool,other_a),(tid,other_did,other_pool,other_b);
      INSERT INTO public.matches(id,tournament_id,division_id,pool_id,team_a_id,team_b_id,round_number,sequence)
        VALUES(other_match,tid,other_did,other_pool,other_a,other_b,1,1);
      k:=0;
      FOR i IN 1..n-1 LOOP FOR j IN i+1..n LOOP
        k:=k+1; mid:=gen_random_uuid();
        INSERT INTO public.matches(id,tournament_id,division_id,pool_id,team_a_id,team_b_id,round_number,sequence)
          VALUES(mid,tid,did,pid,ids[i],ids[j],k,1);
      END LOOP; END LOOP;
      -- A sees its draft, B and anon cannot. All mutations target only fixture IDs.
      IF (SELECT count(*) FROM public.tournaments WHERE id=tid)<>1 THEN RAISE EXCEPTION 'Owner draft missing'; END IF;
      PERFORM set_config('request.jwt.claims',jsonb_build_object('sub',owner_b,'role','authenticated')::text,true);
      IF EXISTS(SELECT 1 FROM public.tournaments WHERE id=tid) OR EXISTS(SELECT 1 FROM public.matches WHERE tournament_id=tid)
        THEN RAISE EXCEPTION 'B reads A draft'; END IF;
      UPDATE public.tournaments SET name='unauthorized' WHERE id=tid;
      GET DIAGNOSTICS changed=ROW_COUNT;
      IF changed<>0 THEN RAISE EXCEPTION 'B changed A tournament'; END IF;
      EXECUTE 'RESET ROLE'; EXECUTE 'SET LOCAL ROLE anon';
      PERFORM set_config('request.jwt.claims','{"role":"anon"}',true);
      IF EXISTS(SELECT 1 FROM public.tournaments WHERE id=tid) OR EXISTS(SELECT 1 FROM public.teams WHERE tournament_id=tid)
        THEN RAISE EXCEPTION 'Anon reads draft'; END IF;
      rejected:=false;
      BEGIN PERFORM public.submit_public_pool_result(mid,good); EXCEPTION WHEN raise_exception THEN rejected:=true; END;
      IF NOT rejected THEN RAISE EXCEPTION 'Anon scored draft'; END IF;
      EXECUTE 'RESET ROLE'; EXECUTE 'SET LOCAL ROLE authenticated';
      PERFORM set_config('request.jwt.claims',jsonb_build_object('sub',owner_a,'role','authenticated')::text,true);
      UPDATE public.tournaments SET status='pool_play' WHERE id=tid;
      UPDATE public.competition_divisions SET status='pool_play' WHERE tournament_id=tid;
      EXECUTE 'RESET ROLE'; EXECUTE 'SET LOCAL ROLE anon';
      PERFORM set_config('request.jwt.claims','{"role":"anon"}',true);
      IF (SELECT count(*) FROM public.matches WHERE division_id=did)<>k THEN RAISE EXCEPTION 'Published fixtures missing'; END IF;
      FOR m IN SELECT * FROM public.matches WHERE division_id=did AND stage='pool' LOOP
        PERFORM public.submit_public_pool_result(m.id,good);
      END LOOP;
      rejected:=false;
      BEGIN PERFORM public.submit_public_pool_result(mid,reverse_score); EXCEPTION WHEN raise_exception THEN rejected:=true; END;
      IF NOT rejected THEN RAISE EXCEPTION 'Public overwrote pool score'; END IF;
      EXECUTE 'RESET ROLE'; EXECUTE 'SET LOCAL ROLE authenticated';
      PERFORM set_config('request.jwt.claims',jsonb_build_object('sub',owner_b,'role','authenticated')::text,true);
      rejected:=false;
      BEGIN PERFORM public.submit_pool_result(mid,reverse_score); EXCEPTION WHEN raise_exception THEN rejected:=true; END;
      IF NOT rejected THEN RAISE EXCEPTION 'B corrected A pool score'; END IF;
      PERFORM set_config('request.jwt.claims',jsonb_build_object('sub',owner_a,'role','authenticated')::text,true);
      PERFORM public.submit_pool_result(mid,reverse_score);
      IF (SELECT score_b FROM public.set_scores WHERE match_id=mid AND set_number=1)<>21 THEN RAISE EXCEPTION 'Owner correction failed'; END IF;
      slots:=1; rounds:=0;
      WHILE slots<n LOOP slots:=slots*2; rounds:=rounds+1; END LOOP;
      SELECT jsonb_agg(jsonb_build_object('round_number',r,'best_of',1,'target_points',21,'win_by_two',true,
        'point_cap',25,'decider_target_points',15,'decider_win_by_two',true,'decider_point_cap',17)) INTO rules
        FROM generate_series(1,rounds+2) r;
      IF n NOT IN (8,16) THEN
        rejected:=false;
        BEGIN PERFORM public.finalize_one_competition_division(tid,did,jsonb_build_object(bid,to_jsonb(ids)),jsonb_build_object(bid,rules),true);
          EXCEPTION WHEN raise_exception THEN rejected:=true; END;
        IF NOT rejected OR EXISTS(SELECT 1 FROM public.playoff_round_rules WHERE bracket_id=bid)
          THEN RAISE EXCEPTION 'Bye-free rejection not atomic'; END IF;
      END IF;
      PERFORM set_config('request.jwt.claims',jsonb_build_object('sub',owner_b,'role','authenticated')::text,true);
      rejected:=false;
      BEGIN PERFORM public.finalize_one_competition_division(tid,did,jsonb_build_object(bid,to_jsonb(ids)),jsonb_build_object(bid,rules),false);
        EXCEPTION WHEN raise_exception THEN rejected:=true; END;
      IF NOT rejected THEN RAISE EXCEPTION 'B finalized A division'; END IF;
      PERFORM set_config('request.jwt.claims',jsonb_build_object('sub',owner_a,'role','authenticated')::text,true);
      PERFORM public.finalize_one_competition_division(tid,did,jsonb_build_object(bid,to_jsonb(ids)),jsonb_build_object(bid,rules),n IN (8,16));
      IF (SELECT status FROM public.competition_divisions WHERE id=other_did)<>'pool_play'
        OR (SELECT status FROM public.matches WHERE id=other_match)<>'scheduled' THEN RAISE EXCEPTION 'Other division changed'; END IF;
      IF (SELECT count(*) FROM public.matches WHERE bracket_id=bid AND playoff_phase='upper' AND round_number=1 AND status='bye')<>slots-n
        THEN RAISE EXCEPTION 'Incorrect first-round byes'; END IF;
      played:=0;
      LOOP
        SELECT * INTO m FROM public.matches WHERE bracket_id=bid AND status='scheduled' AND team_a_id IS NOT NULL AND team_b_id IS NOT NULL
          ORDER BY round_number,sequence,id LIMIT 1;
        EXIT WHEN NOT FOUND;
        IF played>2*n THEN RAISE EXCEPTION 'Playoff loop exceeded bound'; END IF;
        scores:=CASE WHEN m.playoff_phase='grand' AND mode<>2 THEN reverse_score ELSE good END;
        winner:=CASE WHEN scores=good THEN m.team_a_id ELSE m.team_b_id END;
        loser:=CASE WHEN scores=good THEN m.team_b_id ELSE m.team_a_id END;
        EXECUTE 'RESET ROLE'; EXECUTE 'SET LOCAL ROLE anon';
        PERFORM set_config('request.jwt.claims','{"role":"anon"}',true);
        PERFORM public.submit_public_playoff_series(m.id,scores);
        played:=played+1;
        rejected:=false;
        BEGIN PERFORM public.submit_public_playoff_series(m.id,scores); EXCEPTION WHEN raise_exception THEN rejected:=true; END;
        IF NOT rejected THEN RAISE EXCEPTION 'Public overwrote playoff'; END IF;
        EXECUTE 'RESET ROLE'; EXECUTE 'SET LOCAL ROLE authenticated';
        PERFORM set_config('request.jwt.claims',jsonb_build_object('sub',owner_a,'role','authenticated')::text,true);
        IF first_mid IS NULL THEN
          first_mid:=m.id; first_a:=m.team_a_id; first_b:=m.team_b_id;
          PERFORM set_config('request.jwt.claims',jsonb_build_object('sub',owner_b,'role','authenticated')::text,true);
          rejected:=false;
          BEGIN PERFORM public.correct_playoff_series(m.id,reverse_score); EXCEPTION WHEN raise_exception THEN rejected:=true; END;
          IF NOT rejected THEN RAISE EXCEPTION 'B corrected playoff'; END IF;
          PERFORM set_config('request.jwt.claims',jsonb_build_object('sub',owner_a,'role','authenticated')::text,true);
          PERFORM public.correct_playoff_series(m.id,reverse_score);
          FOR link IN SELECT target_match_id,target_slot,true is_winner FROM public.playoff_match_links WHERE source_match_id=m.id
            UNION ALL SELECT target_match_id,target_slot,false FROM public.playoff_loser_links WHERE source_match_id=m.id LOOP
            IF (SELECT CASE WHEN link.target_slot='a' THEN team_a_id ELSE team_b_id END FROM public.matches WHERE id=link.target_match_id)
              IS DISTINCT FROM (CASE WHEN link.is_winner THEN first_b ELSE first_a END) THEN RAISE EXCEPTION 'Correction misrouted'; END IF;
          END LOOP;
          PERFORM public.correct_playoff_series(m.id,good);
        END IF;
        IF m.playoff_phase='grand' AND mode=1 THEN
          -- Reversing the grand final before its reset is played removes/recreates it.
          PERFORM public.correct_playoff_series(m.id,good);
          IF EXISTS(SELECT 1 FROM public.matches WHERE bracket_id=bid AND playoff_phase='reset') THEN RAISE EXCEPTION 'Unused reset not removed'; END IF;
          PERFORM public.correct_playoff_series(m.id,reverse_score);
          IF (SELECT count(*) FROM public.matches WHERE bracket_id=bid AND playoff_phase='reset' AND status='scheduled')<>1 THEN RAISE EXCEPTION 'Reset not recreated'; END IF;
        END IF;
        FOR link IN SELECT target_match_id,target_slot,true is_winner FROM public.playoff_match_links WHERE source_match_id=m.id
          UNION ALL SELECT target_match_id,target_slot,false FROM public.playoff_loser_links WHERE source_match_id=m.id LOOP
          IF (SELECT CASE WHEN link.target_slot='a' THEN team_a_id ELSE team_b_id END FROM public.matches WHERE id=link.target_match_id)
            IS DISTINCT FROM (CASE WHEN link.is_winner THEN winner ELSE loser END) THEN RAISE EXCEPTION 'Advancement misrouted'; END IF;
        END LOOP;
      END LOOP;
      SELECT champion_team_id INTO champion FROM public.playoff_brackets WHERE id=bid AND status='completed';
      IF champion IS NULL THEN RAISE EXCEPTION 'Bracket stalled n=% mode=%',n,mode; END IF;
      expected:=2*n-2+CASE WHEN mode=1 THEN 1 ELSE 0 END;
      IF played<>expected THEN RAISE EXCEPTION 'Wrong game count % expected %',played,expected; END IF;
      IF (SELECT count(*) FROM public.matches WHERE bracket_id=bid AND playoff_phase='reset')<>(CASE WHEN mode=1 THEN 1 ELSE 0 END)
        THEN RAISE EXCEPTION 'Reset creation mismatch'; END IF;
      FOR team IN SELECT id FROM public.teams WHERE division_id=did LOOP
        SELECT count(*) INTO losses FROM public.matches x WHERE x.bracket_id=bid AND x.status='completed'
          AND team.id=CASE WHEN (SELECT count(*) FROM public.set_scores WHERE match_id=x.id AND score_a>score_b)>
            (SELECT count(*) FROM public.set_scores WHERE match_id=x.id AND score_b>score_a) THEN x.team_b_id ELSE x.team_a_id END;
        -- Without reset the previously undefeated finalist can lose the championship with one loss.
        IF team.id<>champion AND losses<>2 AND NOT(mode=0 AND losses=1 AND team.id=(SELECT team_a_id FROM public.matches WHERE bracket_id=bid AND playoff_phase='grand'))
          THEN RAISE EXCEPTION 'Incorrect elimination losses %',losses; END IF;
        IF team.id=champion AND losses>1 THEN RAISE EXCEPTION 'Champion eliminated'; END IF;
      END LOOP;
      IF mode=1 THEN
        SELECT id INTO mid FROM public.matches WHERE bracket_id=bid AND playoff_phase='grand';
        rejected:=false;
        BEGIN PERFORM public.correct_playoff_series(mid,good); EXCEPTION WHEN raise_exception THEN rejected:=true; END;
        IF NOT rejected THEN RAISE EXCEPTION 'Changed grand winner after reset played'; END IF;
      END IF;
      rejected:=false;
      BEGIN PERFORM public.correct_playoff_series(first_mid,reverse_score); EXCEPTION WHEN raise_exception THEN rejected:=true; END;
      IF NOT rejected THEN RAISE EXCEPTION 'Changed winner after descendants played'; END IF;
      IF (SELECT score_a FROM public.set_scores WHERE match_id=first_mid AND set_number=1)<>21 THEN RAISE EXCEPTION 'Rejected correction changed scores'; END IF;
      IF (SELECT status FROM public.competition_divisions WHERE id=other_did)<>'pool_play'
        OR (SELECT status FROM public.tournaments WHERE id=tid)='completed' THEN RAISE EXCEPTION 'Independent division status lost'; END IF;
      PERFORM public.submit_pool_result(other_match,good);
      PERFORM public.finalize_one_competition_division(tid,other_did,'{}','{}',false);
      IF (SELECT status FROM public.tournaments WHERE id=tid)<>'completed' THEN RAISE EXCEPTION 'Aggregate completion failed'; END IF;
      EXECUTE 'RESET ROLE';
      results:=results||jsonb_build_object('teams',n,'mode',mode,'pool_matches',k,'playoff_matches',played,'passed',true);
    END LOOP;
  END LOOP;
  PERFORM set_config('qa.result',results::text,true);
END $test$;
SELECT current_setting('qa.result')::jsonb AS results;
ROLLBACK;
