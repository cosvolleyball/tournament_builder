-- Tournament Builder starter — run this SQL in a NEW Supabase project.
-- Never run it in the existing COS Volleyball project.
-- Public read access is allowed only for non-draft tournaments.
-- Writes are restricted to the authenticated tournament owner.

create table if not exists public.tournaments (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references auth.users(id) on delete cascade,
  name text not null check (char_length(trim(name)) between 1 and 120),
  sport text not null default 'Volleyball',
  starts_on date,
  status text not null default 'draft' check (status in ('draft','published','pool_play','pool_finalized','playoffs','completed')),
  pool_count integer not null check (pool_count between 1 and 32),
  pool_sets integer not null check (pool_sets in (1,2)),
  target_points integer not null check (target_points between 1 and 100),
  win_by_two boolean not null default true,
  seed_mode text not null check (seed_mode in ('snake','random')),
  created_at timestamptz not null default now()
);
create index if not exists tournaments_owner_idx on public.tournaments(owner_id);

create table if not exists public.teams (
  id uuid primary key default gen_random_uuid(),
  tournament_id uuid not null references public.tournaments(id) on delete cascade,
  name text not null check (char_length(trim(name)) between 1 and 100),
  seed integer not null check (seed > 0),
  unique (tournament_id, seed), unique (tournament_id, name), unique (id, tournament_id)
);
create index if not exists teams_tournament_idx on public.teams(tournament_id);

create table if not exists public.pools (
  id uuid primary key default gen_random_uuid(),
  tournament_id uuid not null references public.tournaments(id) on delete cascade,
  label text not null,
  sort_order integer not null,
  unique (id, tournament_id), unique (tournament_id, sort_order)
);
create index if not exists pools_tournament_idx on public.pools(tournament_id);

create table if not exists public.pool_teams (
  tournament_id uuid not null references public.tournaments(id) on delete cascade,
  pool_id uuid not null,
  team_id uuid not null,
  primary key (pool_id, team_id),
  unique (team_id),
  foreign key (pool_id, tournament_id) references public.pools(id, tournament_id) on delete cascade,
  foreign key (team_id, tournament_id) references public.teams(id, tournament_id) on delete cascade
);
create index if not exists pool_teams_tournament_idx on public.pool_teams(tournament_id);

create table if not exists public.matches (
  id uuid primary key default gen_random_uuid(),
  tournament_id uuid not null references public.tournaments(id) on delete cascade,
  pool_id uuid not null,
  team_a_id uuid not null,
  team_b_id uuid not null,
  round_number integer not null check (round_number > 0),
  sequence integer not null check (sequence > 0),
  status text not null default 'scheduled' check (status in ('scheduled','completed')),
  check (team_a_id <> team_b_id),
  unique (id, tournament_id),
  foreign key (pool_id, tournament_id) references public.pools(id, tournament_id) on delete cascade,
  foreign key (team_a_id, tournament_id) references public.teams(id, tournament_id) on delete cascade,
  foreign key (team_b_id, tournament_id) references public.teams(id, tournament_id) on delete cascade
);
create index if not exists matches_tournament_idx on public.matches(tournament_id);

create table if not exists public.set_scores (
  match_id uuid not null references public.matches(id) on delete cascade,
  set_number integer not null check (set_number in (1,2)),
  score_a integer not null check (score_a between 0 and 999),
  score_b integer not null check (score_b between 0 and 999),
  check (score_a <> score_b),
  primary key (match_id, set_number)
);

create table if not exists public.playoff_divisions (
  id uuid primary key default gen_random_uuid(),
  tournament_id uuid not null references public.tournaments(id) on delete cascade,
  name text not null,
  format text not null check (format in ('single','double')),
  bracket_reset boolean not null default true,
  sort_order integer not null,
  unique (tournament_id, name)
);

-- RLS policies (the frontend uses only a publishable/anon key; never service_role).
alter table public.tournaments enable row level security;
alter table public.teams enable row level security;
alter table public.pools enable row level security;
alter table public.pool_teams enable row level security;
alter table public.matches enable row level security;
alter table public.set_scores enable row level security;
alter table public.playoff_divisions enable row level security;

create policy "Readable published tournaments or owned drafts" on public.tournaments
for select to anon, authenticated using (status <> 'draft' or owner_id = (select auth.uid()));
create policy "Owners insert tournaments" on public.tournaments
for insert to authenticated with check (owner_id = (select auth.uid()));
create policy "Owners update tournaments" on public.tournaments
for update to authenticated using (owner_id = (select auth.uid())) with check (owner_id = (select auth.uid()));
create policy "Owners delete tournaments" on public.tournaments
for delete to authenticated using (owner_id = (select auth.uid()));

-- Both writes and reads to child tables are checked against their owning tournament.
create or replace function public.can_read_tournament(p_id uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists(select 1 from public.tournaments t where t.id = p_id and (t.status <> 'draft' or t.owner_id = (select auth.uid())));
$$;
create or replace function public.owns_tournament(p_id uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists(select 1 from public.tournaments t where t.id = p_id and t.owner_id = (select auth.uid()));
$$;
revoke all on function public.owns_tournament(uuid) from public;
revoke all on function public.can_read_tournament(uuid) from public;
grant execute on function public.can_read_tournament(uuid) to anon, authenticated;
grant execute on function public.owns_tournament(uuid) to authenticated;

create policy "Readable teams" on public.teams for select to anon, authenticated using (public.can_read_tournament(tournament_id));
create policy "Owner inserts teams" on public.teams for insert to authenticated with check (public.owns_tournament(tournament_id));
create policy "Owner edits teams" on public.teams for update to authenticated using (public.owns_tournament(tournament_id)) with check (public.owns_tournament(tournament_id));
create policy "Owner deletes teams" on public.teams for delete to authenticated using (public.owns_tournament(tournament_id));

create policy "Readable pools" on public.pools for select to anon, authenticated using (public.can_read_tournament(tournament_id));
create policy "Owner inserts pools" on public.pools for insert to authenticated with check (public.owns_tournament(tournament_id));
create policy "Owner edits pools" on public.pools for update to authenticated using (public.owns_tournament(tournament_id)) with check (public.owns_tournament(tournament_id));
create policy "Owner deletes pools" on public.pools for delete to authenticated using (public.owns_tournament(tournament_id));

create policy "Readable pool team assignments" on public.pool_teams for select to anon, authenticated using (public.can_read_tournament(tournament_id));
create policy "Owner inserts pool team assignments" on public.pool_teams for insert to authenticated with check (public.owns_tournament(tournament_id));
create policy "Owner edits pool team assignments" on public.pool_teams for update to authenticated using (public.owns_tournament(tournament_id)) with check (public.owns_tournament(tournament_id));
create policy "Owner deletes pool team assignments" on public.pool_teams for delete to authenticated using (public.owns_tournament(tournament_id));

create policy "Readable matches" on public.matches for select to anon, authenticated using (public.can_read_tournament(tournament_id));
create policy "Owner inserts matches" on public.matches for insert to authenticated with check (public.owns_tournament(tournament_id));
create policy "Owner edits matches" on public.matches for update to authenticated using (public.owns_tournament(tournament_id)) with check (public.owns_tournament(tournament_id));
create policy "Owner deletes matches" on public.matches for delete to authenticated using (public.owns_tournament(tournament_id));

create policy "Readable set scores" on public.set_scores for select to anon, authenticated
using (exists(select 1 from public.matches m where m.id = match_id and public.can_read_tournament(m.tournament_id)));
create policy "Owner inserts set scores" on public.set_scores for insert to authenticated
with check (exists(select 1 from public.matches m where m.id = match_id and public.owns_tournament(m.tournament_id)));
create policy "Owner edits set scores" on public.set_scores for update to authenticated
using (exists(select 1 from public.matches m where m.id = match_id and public.owns_tournament(m.tournament_id)))
with check (exists(select 1 from public.matches m where m.id = match_id and public.owns_tournament(m.tournament_id)));
create policy "Owner deletes set scores" on public.set_scores for delete to authenticated
using (exists(select 1 from public.matches m where m.id = match_id and public.owns_tournament(m.tournament_id)));

create policy "Readable playoff divisions" on public.playoff_divisions for select to anon, authenticated using (public.can_read_tournament(tournament_id));
create policy "Owner inserts playoff divisions" on public.playoff_divisions for insert to authenticated with check (public.owns_tournament(tournament_id));
create policy "Owner edits playoff divisions" on public.playoff_divisions for update to authenticated using (public.owns_tournament(tournament_id)) with check (public.owns_tournament(tournament_id));
create policy "Owner deletes playoff divisions" on public.playoff_divisions for delete to authenticated using (public.owns_tournament(tournament_id));

-- Atomic and validated result submission. Explicit owner gate; no public score writes.
create or replace function public.submit_pool_result(p_match_id uuid, p_scores jsonb)
returns void language plpgsql security invoker set search_path = '' as $$
declare
  v_match public.matches%rowtype;
  v_t public.tournaments%rowtype;
  v_set jsonb;
  v_n integer := 0;
  v_a integer;
  v_b integer;
begin
  select * into v_match from public.matches where id = p_match_id;
  if not found then raise exception 'Match not found'; end if;
  if not public.owns_tournament(v_match.tournament_id) then raise exception 'Not authorized'; end if;
  select * into v_t from public.tournaments where id = v_match.tournament_id;
  if v_t.status not in ('published','pool_play') then
    raise exception 'Publish the tournament before entering scores';
  end if;
  if jsonb_typeof(p_scores) <> 'array' or jsonb_array_length(p_scores) <> v_t.pool_sets then
    raise exception 'Exactly % sets are required', v_t.pool_sets;
  end if;
  delete from public.set_scores where match_id = p_match_id;
  for v_set in select value from jsonb_array_elements(p_scores) loop
    v_n := v_n + 1;
    v_a := (v_set->>'score_a')::integer;
    v_b := (v_set->>'score_b')::integer;
    if v_set->>'set_number' <> v_n::text or v_a is null or v_b is null or v_a < 0 or v_b < 0 or v_a > 999 or v_b > 999 or v_a = v_b then
      raise exception 'Invalid set % score', v_n;
    end if;
    if greatest(v_a,v_b) < v_t.target_points then raise exception 'Winning score is below target'; end if;
    if v_t.win_by_two then
      if abs(v_a-v_b) < 2 or (greatest(v_a,v_b) > v_t.target_points and abs(v_a-v_b) <> 2) then
        raise exception 'Invalid win-by-two score';
      end if;
    elsif greatest(v_a,v_b) <> v_t.target_points then
      raise exception 'Winning score must equal the target';
    end if;
    insert into public.set_scores (match_id, set_number, score_a, score_b) values(p_match_id, v_n, v_a, v_b);
  end loop;
  update public.matches set status = 'completed' where id = p_match_id;
  update public.tournaments set status = 'pool_play' where id = v_match.tournament_id and status = 'published';
end;
$$;
revoke all on function public.submit_pool_result(uuid, jsonb) from public;
grant execute on function public.submit_pool_result(uuid, jsonb) to authenticated;
