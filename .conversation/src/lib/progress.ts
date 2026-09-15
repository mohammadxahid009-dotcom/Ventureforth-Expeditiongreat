import { supabase } from "@/integrations/supabase/client";
import type { LatLng } from "@/lib/expedition";

export type Progress = {
  level: number;
  completed: number;
  trail: LatLng[];
  destination: LatLng | null;
  expeditionActive: boolean;
};

export const EMPTY_PROGRESS: Progress = {
  level: 1,
  completed: 0,
  trail: [],
  destination: null,
  expeditionActive: false,
};

function isLatLng(v: unknown): v is LatLng {
  return (
    !!v &&
    typeof v === "object" &&
    typeof (v as LatLng).lat === "number" &&
    typeof (v as LatLng).lng === "number"
  );
}

export async function loadProgress(userId: string): Promise<Progress> {
  const { data, error } = await supabase
    .from("game_progress")
    .select("level, completed, trail, destination, expedition_active")
    .eq("user_id", userId)
    .maybeSingle();

  if (error || !data) return EMPTY_PROGRESS;

  const trail = Array.isArray(data.trail) ? (data.trail as unknown[]).filter(isLatLng) : [];
  return {
    level: data.level ?? 1,
    completed: data.completed ?? 0,
    trail,
    destination: isLatLng(data.destination) ? data.destination : null,
    expeditionActive: !!data.expedition_active,
  };
}

/** Cap stored trail so long-term play stays cheap while keeping the whole map. */
function compactTrail(trail: LatLng[]): LatLng[] {
  const MAX = 4000;
  if (trail.length <= MAX) return trail;
  const stride = Math.ceil(trail.length / MAX);
  const out = trail.filter((_, i) => i % stride === 0);
  const last = trail[trail.length - 1];
  if (last && out[out.length - 1] !== last) out.push(last);
  return out;
}

export async function saveProgress(userId: string, p: Progress) {
  await supabase.from("game_progress").upsert(
    {
      user_id: userId,
      level: p.level,
      completed: p.completed,
      trail: compactTrail(p.trail),
      destination: p.destination,
      expedition_active: p.expeditionActive,
    },
    { onConflict: "user_id" },
  );
}
