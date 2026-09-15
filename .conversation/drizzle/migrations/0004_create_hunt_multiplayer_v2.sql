create table if not exists public.hunt_rooms (
  id uuid primary key default gen_random_uuid(),
  code text not null unique,
  mode text not null check (mode in ('team','vs')),
  state text not null default 'waiting' check (state in ('waiting','active','finished','cancelled')),
  host_user_id uuid not null references auth.users(id) on delete cascade,
  winner_user_id uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.hunt_players (
  id uuid primary key default gen_random_uuid(),
  room_id uuid not null references public.hunt_rooms(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  display_name text not null default 'Explorer',
  status text not null default 'active' check (status in ('active','left','completed')),
  joined_at timestamptz not null default now(),
  completed_at timestamptz,
  unique (room_id, user_id)
);

create table if not exists public.hunt_targets (
  id uuid primary key default gen_random_uuid(),
  room_id uuid not null references public.hunt_rooms(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  destination jsonb not null,
  created_at timestamptz not null default now(),
  unique (room_id, user_id)
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.hunt_rooms TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.hunt_players TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.hunt_targets TO authenticated;
GRANT ALL ON public.hunt_rooms TO service_role;
GRANT ALL ON public.hunt_players TO service_role;
GRANT ALL ON public.hunt_targets TO service_role;

alter table public.hunt_rooms enable row level security;
alter table public.hunt_players enable row level security;
alter table public.hunt_targets enable row level security;

create or replace function public.is_hunt_member(_room_id uuid, _user_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.hunt_players
    where room_id = _room_id and user_id = _user_id and status <> 'left'
  )
$$;

drop policy if exists "Members can read their rooms" on public.hunt_rooms;
create policy "Members can read their rooms"
  on public.hunt_rooms for select to authenticated
  using (public.is_hunt_member(id, auth.uid()) or host_user_id = auth.uid());

drop policy if exists "Members can read their room's players" on public.hunt_players;
create policy "Members can read their room's players"
  on public.hunt_players for select to authenticated
  using (public.is_hunt_member(room_id, auth.uid()) or user_id = auth.uid());

drop policy if exists "Room members can read targets" on public.hunt_targets;
create policy "Room members can read targets"
  on public.hunt_targets for select to authenticated
  using (public.is_hunt_member(room_id, auth.uid()) or user_id = auth.uid());

create or replace function public.create_hunt_room(p_mode text, p_display_name text)
returns public.hunt_rooms
language plpgsql
security definer
set search_path = public
as $$
declare
  v_room public.hunt_rooms;
  v_code text;
  v_attempts int := 0;
begin
  if auth.uid() is null then
    raise exception 'Not authenticated';
  end if;
  if p_mode not in ('team','vs') then
    raise exception 'Invalid hunt mode';
  end if;
  loop
    v_code := upper(substr(replace(gen_random_uuid()::text, '-', ''), 1, 6));
    begin
      insert into public.hunt_rooms (code, mode, host_user_id)
      values (v_code, p_mode, auth.uid())
      returning * into v_room;
      exit;
    exception when unique_violation then
      v_attempts := v_attempts + 1;
      if v_attempts > 10 then
        raise;
      end if;
    end;
  end loop;
  insert into public.hunt_players (room_id, user_id, display_name)
  values (v_room.id, auth.uid(), coalesce(nullif(trim(p_display_name), ''), 'Explorer'));
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
  v_count int;
begin
  if auth.uid() is null then
    raise exception 'Not authenticated';
  end if;
  select * into v_room from public.hunt_rooms where code = upper(trim(p_code)) for update;
  if not found then
    raise exception 'Room not found. Check the code and try again.';
  end if;
  if v_room.state <> 'waiting' then
    raise exception 'This hunt has already started.';
  end if;
  if exists (select 1 from public.hunt_players where room_id = v_room.id and user_id = auth.uid() and status <> 'left') then
    return v_room;
  end if;
  select count(*) into v_count from public.hunt_players
    where room_id = v_room.id and status <> 'left';
  if v_count >= 4 then
    raise exception 'This room is full.';
  end if;
  insert into public.hunt_players (room_id, user_id, display_name, status)
  values (v_room.id, auth.uid(), coalesce(nullif(trim(p_display_name), ''), 'Explorer'), 'active')
  on conflict (room_id, user_id) do update set status = 'active', display_name = excluded.display_name;
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
  if auth.uid() is null then
    raise exception 'Not authenticated';
  end if;
  update public.hunt_rooms
  set state = 'active', updated_at = now()
  where id = p_room_id and host_user_id = auth.uid() and state = 'waiting'
  returning * into v_room;
  if not found then
    raise exception 'Only the host can start a waiting hunt.';
  end if;
  return v_room;
end;
$$;

create or replace function public.leave_hunt_room(p_room_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if auth.uid() is null then
    raise exception 'Not authenticated';
  end if;
  update public.hunt_players
  set status = 'left'
  where room_id = p_room_id and user_id = auth.uid();
  update public.hunt_rooms
  set state = 'cancelled', updated_at = now()
  where id = p_room_id and host_user_id = auth.uid() and state = 'waiting';
end;
$$;

create or replace function public.set_hunt_target(p_room_id uuid, p_destination jsonb)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if auth.uid() is null then
    raise exception 'Not authenticated';
  end if;
  if not public.is_hunt_member(p_room_id, auth.uid()) then
    raise exception 'You are not a member of this room.';
  end if;
  if not exists (select 1 from public.hunt_rooms where id = p_room_id and state = 'active') then
    raise exception 'The hunt is not active.';
  end if;
  insert into public.hunt_targets (room_id, user_id, destination)
  values (p_room_id, auth.uid(), p_destination)
  on conflict (room_id, user_id) do update set destination = excluded.destination;
end;
$$;

create or replace function public.complete_hunt_target(p_room_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_room public.hunt_rooms;
begin
  if auth.uid() is null then
    raise exception 'Not authenticated';
  end if;
  update public.hunt_players
  set status = 'completed', completed_at = now()
  where room_id = p_room_id and user_id = auth.uid() and status = 'active';
  select * into v_room from public.hunt_rooms where id = p_room_id;
  if v_room.mode = 'vs' and v_room.state = 'active' then
    update public.hunt_rooms
    set state = 'finished', winner_user_id = auth.uid(), updated_at = now()
    where id = p_room_id and state = 'active';
  elsif v_room.mode = 'team' and v_room.state = 'active'
    and not exists (
      select 1 from public.hunt_players
      where room_id = p_room_id and status = 'active'
    ) then
    update public.hunt_rooms
    set state = 'finished', updated_at = now()
    where id = p_room_id and state = 'active';
  end if;
end;
$$;

do $$
begin
  if not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'hunt_rooms') then
    alter publication supabase_realtime add table public.hunt_rooms;
  end if;
  if not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'hunt_players') then
    alter publication supabase_realtime add table public.hunt_players;
  end if;
end $$;