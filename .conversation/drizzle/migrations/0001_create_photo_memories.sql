CREATE TABLE public.photo_memories (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users ON DELETE CASCADE,
  lat double precision NOT NULL,
  lng double precision NOT NULL,
  size_m double precision NOT NULL DEFAULT 60,
  storage_path text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.photo_memories TO authenticated;
GRANT ALL ON public.photo_memories TO service_role;

ALTER TABLE public.photo_memories ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users manage their own photo memories"
ON public.photo_memories FOR ALL TO authenticated
USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);

CREATE INDEX photo_memories_user_idx ON public.photo_memories (user_id);

CREATE OR REPLACE FUNCTION public.update_updated_at_column()
RETURNS TRIGGER AS $$ BEGIN NEW.updated_at = now(); RETURN NEW; END; $$
LANGUAGE plpgsql SET search_path = public;

CREATE TRIGGER update_photo_memories_updated_at
BEFORE UPDATE ON public.photo_memories
FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();