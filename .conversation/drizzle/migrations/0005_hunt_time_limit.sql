-- Optional host-configured time pressure for multiplayer hunts.
ALTER TABLE public.hunt_rooms
  ADD COLUMN IF NOT EXISTS time_limit_minutes integer,
  ADD COLUMN IF NOT EXISTS expires_at timestamptz;

-- Start a hunt with an optional time limit (5 minutes .. 3 hours).
CREATE OR REPLACE FUNCTION public.start_hunt_room_timed(p_room_id uuid, p_time_limit_minutes integer DEFAULT NULL)
RETURNS public.hunt_rooms
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
declare
  v_room public.hunt_rooms;
  v_limit integer := p_time_limit_minutes;
begin
  if auth.uid() is null then
    raise exception 'Not authenticated';
  end if;
  if v_limit is not null and (v_limit < 5 or v_limit > 180) then
    raise exception 'Time limit must be between 5 and 180 minutes.';
  end if;
  update public.hunt_rooms
  set state = 'active',
      started_at = now(),
      time_limit_minutes = v_limit,
      expires_at = case when v_limit is null then null else now() + make_interval(mins => v_limit) end,
      updated_at = now()
  where id = p_room_id and host_user_id = auth.uid() and state = 'waiting'
  returning * into v_room;
  if not found then
    raise exception 'Only the host can start a waiting hunt.';
  end if;
  return v_room;
end;
$function$;

-- Keep the original single-argument entry point working (no time limit).
CREATE OR REPLACE FUNCTION public.start_hunt_room(p_room_id uuid)
RETURNS public.hunt_rooms
LANGUAGE sql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
  select public.start_hunt_room_timed(p_room_id, null);
$function$;

-- Any member may close out a hunt whose clock has run out.
CREATE OR REPLACE FUNCTION public.expire_hunt_room(p_room_id uuid)
RETURNS public.hunt_rooms
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
declare
  v_room public.hunt_rooms;
begin
  if auth.uid() is null then
    raise exception 'Not authenticated';
  end if;
  if not public.is_hunt_member(p_room_id, auth.uid()) then
    raise exception 'You are not a member of this room.';
  end if;
  update public.hunt_rooms
  set state = 'finished', finished_at = now(), updated_at = now()
  where id = p_room_id
    and state = 'active'
    and expires_at is not null
    and expires_at <= now()
  returning * into v_room;
  if not found then
    select * into v_room from public.hunt_rooms where id = p_room_id;
  end if;
  return v_room;
end;
$function$;

-- A completion after the deadline never wins the hunt.
CREATE OR REPLACE FUNCTION public.complete_hunt_target(p_room_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
declare
  v_room public.hunt_rooms;
begin
  if auth.uid() is null then
    raise exception 'Not authenticated';
  end if;
  select * into v_room from public.hunt_rooms where id = p_room_id;
  if v_room.expires_at is not null and v_room.expires_at <= now() then
    update public.hunt_rooms
    set state = 'finished', finished_at = now(), updated_at = now()
    where id = p_room_id and state = 'active';
    raise exception 'Time is up for this hunt.';
  end if;
  update public.hunt_players
  set status = 'completed', completed_at = now()
  where room_id = p_room_id and user_id = auth.uid() and status = 'active';
  if v_room.mode = 'vs' and v_room.state = 'active' then
    update public.hunt_rooms
    set state = 'finished', winner_user_id = auth.uid(), finished_at = now(), updated_at = now()
    where id = p_room_id and state = 'active';
  elsif v_room.mode = 'team' and v_room.state = 'active'
    and not exists (
      select 1 from public.hunt_players
      where room_id = p_room_id and status = 'active'
    ) then
    update public.hunt_rooms
    set state = 'finished', finished_at = now(), updated_at = now()
    where id = p_room_id and state = 'active';
  end if;
end;
$function$;

GRANT EXECUTE ON FUNCTION public.start_hunt_room_timed(uuid, integer) TO authenticated;
GRANT EXECUTE ON FUNCTION public.expire_hunt_room(uuid) TO authenticated;
