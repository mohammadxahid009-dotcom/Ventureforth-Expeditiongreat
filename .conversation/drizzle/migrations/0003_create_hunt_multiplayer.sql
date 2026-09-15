-- VentureForth multiplayer rooms, membership, per-player targets, and secure realtime channels.
-- Location is intentionally carried by Supabase Realtime Presence/Broadcast, never persisted here.

create extension if not exists pgcrypto;

create table public.hunt_rooms (
  id uuid primary key default gen_random_uuid(),
  code text not null unique check (code ~ '^[A-Z0-9]{6}$'),
  mode text not null check (mode in ('team', 'vs')),
  state text not null default 'waiting' check (state in ('waiting', 'active', 'finished', 'cancelled')),
  host_user_id uuid not null references auth.users(id) on delete cascade,
  winner_user_id uuid references auth.users(id) on delete set null,
  max_players smallint not null default 4 check (max_players between 2 and 4),
  created_at timestamptz not null default now(),
  started_at timestamptz,
  finished_at timestamptz,
  updated_at timestamptz not null default now()
);

create table public.hunt_players (
  room_id uuid not null references public.hunt_rooms(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  display_name text not null check (char_length(display_name) between 1 and 32),
  status text not null default 'waiting' check (status in ('waiting', 'active', 'left', 'completed')),
  joined_at timestamptz not null default now(),
  completed_at timestamptz,
  primary key (room_id, user_id)
);

-- A target stays private to its owner. It is geographic data, so do not expose it
-- to the room roster or the realtime location channel.
create table public.hunt_targets (
  room_id uuid not null,
  user_id uuid not null,
  destination jsonb not null,
  assigned_at timestamptz not null default now(),
  completed_at timestamptz,
  primary key (room_id, user_id),
  foreign key (room_id, user_id) references public.hunt_players(room_id, user_id) on delete cascade,
  check (
    jsonb_typeof(destination) = 'object'
    and jsonb_typeof(destination->'lat') = 'number'
    and jsonb_typeof(destination->'lng') = 'number'
  )
);

create index hunt_players_room_active_idx on public.hunt_players (room_id, status, joined_at);
create index hunt_rooms_code_idx on public.hunt_rooms (code);

create trigger update_hunt_rooms_updated_at
  before update on public.hunt_rooms
  for each row execute function public.update_updated_at_column();

alter table public.hunt_rooms enable row level security;
alter table public.hunt_players enable row level security;
alter table public.hunt_targets enable row level security;

-- Security-definer helpers avoid recursive RLS checks in membership policies.
create or replace function public.is_hunt_member(p_room_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.hunt_players
    where room_id = p_room_id
      and user_id = auth.uid()
      and status <> 'left'
  );
$$;

create or replace function public.is_hunt_realtime_member(p_topic text)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.hunt_players
    where user_id = auth.uid()
      and status <> 'left'
      and p_topic = 'hunt:' || room_id::text
  );
$$;

grant execute on function public.is_hunt_member(uuid) to authenticated;
grant execute on function public.is_hunt_realtime_member(text) to authenticated;

create policy "room members can read their room"
  on public.hunt_rooms for select to authenticated
  using (public.is_hunt_member(id));

create policy "room members can read the roster"
  on public.hunt_players for select to authenticated
  using (public.is_hunt_member(room_id));

create policy "players can read only their target"
  on public.hunt_targets for select to authenticated
  using (user_id = auth.uid() and public.is_hunt_member(room_id));

-- All room state changes go through the RPCs below, keeping capacity and host
-- checks on the database rather than in the browser.
revoke all on public.hunt_rooms, public.hunt_players, public.hunt_targets from authenticated;
grant select on public.hunt_rooms, public.hunt_players, public.hunt_targets to authenticated;

create or replace function public.create_hunt_room(p_mode text, p_display_name text)
returns public.hunt_rooms
language plpgsql
security definer
set search_path = public
as $$
declare
  v_room public.hunt_rooms;
  v_code text;
  v_name text := left(trim(coalesce(p_display_name, 'Explorer')), 32);
  v_attempt integer;
begin
  if auth.uid() is null then raise exception 'Sign in to create a hunt'; end if;
  if p_mode not in ('team', 'vs') then raise exception 'Choose Team Hunt or VS Hunt'; end if;
  if v_name = '' then v_name := 'Explorer'; end if;

  for v_attempt in 1..12 loop
    v_code := upper(substr(encode(gen_random_bytes(6), 'hex'), 1, 6));
    begin
      insert into public.hunt_rooms (code, mode, host_user_id)
      values (v_code, p_mode, auth.uid())
      returning * into v_room;
      exit;
    exception when unique_violation then
      -- Extremely unlikely code collision; simply draw a fresh code.
    end;
  end loop;
  if v_room.id is null then raise exception 'Could not create a room. Try again.'; end if;

  insert into public.hunt_players (room_id, user_id, display_name)
  values (v_room.id, auth.uid(), v_name);
  return v_room;
end;
$$;

create or replace function public.join_hunt_room(p_code text, p_display_name text)
returns public.hunt_rooms
language plpgsql
security definer
set search_path = public
as $$
declare
  v_room public.hunt_rooms;
  v_count integer;
  v_name text := left(trim(coalesce(p_display_name, 'Explorer')), 32);
begin
  if auth.uid() is null then raise exception 'Sign in to join a hunt'; end if;
  if v_name = '' then v_name := 'Explorer'; end if;

  select * into v_room
  from public.hunt_rooms
  where code = upper(trim(p_code))
  for update;

  if v_room.id is null then raise exception 'Room code not found'; end if;
  if v_room.state <> 'waiting' then raise exception 'This hunt has already started'; end if;

  select count(*) into v_count
  from public.hunt_players
  where room_id = v_room.id and status <> 'left';

  if v_count >= v_room.max_players and not exists (
    select 1 from public.hunt_players where room_id = v_room.id and user_id = auth.uid() and status <> 'left'
  ) then
    raise exception 'This room is full';
  end if;

  insert into public.hunt_players (room_id, user_id, display_name, status)
  values (v_room.id, auth.uid(), v_name, 'waiting')
  on conflict (room_id, user_id) do update
    set display_name = excluded.display_name, status = 'waiting', joined_at = now(), completed_at = null;

  return v_room;
end;
$$;

create or replace function public.start_hunt_room(p_room_id uuid)
returns public.hunt_rooms
language plpgsql
security definer
set search_path = public
as $$
declare
  v_room public.hunt_rooms;
begin
  select * into v_room from public.hunt_rooms where id = p_room_id for update;
  if v_room.id is null then raise exception 'Room not found'; end if;
  if v_room.host_user_id <> auth.uid() then raise exception 'Only the host can start this hunt'; end if;
  if v_room.state <> 'waiting' then raise exception 'This hunt has already started'; end if;

  update public.hunt_rooms
  set state = 'active', started_at = now()
  where id = p_room_id
  returning * into v_room;

  update public.hunt_players
  set status = 'active'
  where room_id = p_room_id and status = 'waiting';

  return v_room;
end;
$$;

create or replace function public.leave_hunt_room(p_room_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_room public.hunt_rooms;
  v_new_host uuid;
begin
  select * into v_room from public.hunt_rooms where id = p_room_id for update;
  if v_room.id is null or not public.is_hunt_member(p_room_id) then return; end if;

  update public.hunt_players
  set status = 'left'
  where room_id = p_room_id and user_id = auth.uid();

  if v_room.host_user_id = auth.uid() then
    select user_id into v_new_host
    from public.hunt_players
    where room_id = p_room_id and status <> 'left'
    order by joined_at
    limit 1;

    update public.hunt_rooms
    set host_user_id = coalesce(v_new_host, host_user_id),
        state = case when v_new_host is null then 'cancelled' else state end
    where id = p_room_id;
  end if;
end;
$$;

create or replace function public.set_hunt_target(p_room_id uuid, p_destination jsonb)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if not public.is_hunt_member(p_room_id) then raise exception 'You are not in this room'; end if;
  if not exists (select 1 from public.hunt_rooms where id = p_room_id and state = 'active') then
    raise exception 'This hunt is not active';
  end if;
  if jsonb_typeof(p_destination) <> 'object'
     or jsonb_typeof(p_destination->'lat') <> 'number'
     or jsonb_typeof(p_destination->'lng') <> 'number' then
    raise exception 'Invalid destination';
  end if;

  insert into public.hunt_targets (room_id, user_id, destination)
  values (p_room_id, auth.uid(), p_destination)
  on conflict (room_id, user_id) do update
    set destination = excluded.destination, assigned_at = now(), completed_at = null;
end;
$$;

create or replace function public.complete_hunt_target(p_room_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $complete_hunt$
declare
  v_mode text;
  v_updated integer;
begin
  if not public.is_hunt_member(p_room_id) then raise exception 'You are not in this room'; end if;
  select mode into v_mode from public.hunt_rooms where id = p_room_id and state = 'active' for update;
  if v_mode is null then raise exception 'This hunt is not active'; end if;

  -- In VS, this conditional update is the authoritative first-finisher decision.
  -- Concurrent phone updates cannot create two winners.
  if v_mode = 'vs' then
    update public.hunt_rooms
    set state = 'finished', finished_at = now(), winner_user_id = auth.uid()
    where id = p_room_id and state = 'active';
    get diagnostics v_updated = row_count;
    if v_updated = 0 then raise exception 'Another explorer already finished first'; end if;
  end if;

  update public.hunt_targets
  set completed_at = coalesce(completed_at, now())
  where room_id = p_room_id and user_id = auth.uid();

  update public.hunt_players
  set status = 'completed', completed_at = coalesce(completed_at, now())
  where room_id = p_room_id and user_id = auth.uid();
end;
$complete_hunt$;

grant execute on function public.create_hunt_room(text, text) to authenticated;
grant execute on function public.join_hunt_room(text, text) to authenticated;
grant execute on function public.start_hunt_room(uuid) to authenticated;
grant execute on function public.leave_hunt_room(uuid) to authenticated;
grant execute on function public.set_hunt_target(uuid, jsonb) to authenticated;
grant execute on function public.complete_hunt_target(uuid) to authenticated;

-- Room metadata/roster changes are durable database events. GPS is not.
alter table public.hunt_rooms replica identity full;
alter table public.hunt_players replica identity full;
alter publication supabase_realtime add table public.hunt_rooms;
alter publication supabase_realtime add table public.hunt_players;

-- Private Realtime topic policies: only a current room member may join,
-- receive Presence/Broadcast messages, or publish a location to that room.
create policy "hunt members receive realtime"
  on realtime.messages for select to authenticated
  using (public.is_hunt_realtime_member(realtime.topic()));

create policy "hunt members send realtime"
  on realtime.messages for insert to authenticated
  with check (public.is_hunt_realtime_member(realtime.topic()));
