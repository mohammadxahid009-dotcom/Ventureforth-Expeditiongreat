import { supabase } from "@/integrations/supabase/client";
import type { LatLng } from "@/lib/expedition";

export type PhotoMemory = {
  id: string;
  lat: number;
  lng: number;
  sizeM: number;
  path: string;
  url: string;
};

const BUCKET = "photo-memories";
const SIGNED_TTL = 60 * 60 * 24 * 7; // a week

/** Centre-crop to 1:1 and shrink/compress before upload. */
export async function compressToSquare(file: File, max = 1024, quality = 0.82): Promise<Blob> {
  const bitmap = await createImageBitmap(file);
  const side = Math.min(bitmap.width, bitmap.height);
  const out = Math.min(side, max);
  const canvas = document.createElement("canvas");
  canvas.width = out;
  canvas.height = out;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("Canvas unavailable");
  ctx.drawImage(
    bitmap,
    (bitmap.width - side) / 2,
    (bitmap.height - side) / 2,
    side,
    side,
    0,
    0,
    out,
    out,
  );
  bitmap.close?.();
  return await new Promise<Blob>((resolve, reject) =>
    canvas.toBlob(
      (b) => (b ? resolve(b) : reject(new Error("Compression failed"))),
      "image/jpeg",
      quality,
    ),
  );
}

async function sign(paths: string[]): Promise<Record<string, string>> {
  if (!paths.length) return {};
  const { data } = await supabase.storage.from(BUCKET).createSignedUrls(paths, SIGNED_TTL);
  const map: Record<string, string> = {};
  for (const row of data ?? []) if (row.path && row.signedUrl) map[row.path] = row.signedUrl;
  return map;
}

export async function listPhotos(userId: string): Promise<PhotoMemory[]> {
  const { data, error } = await supabase
    .from("photo_memories")
    .select("id, lat, lng, size_m, storage_path")
    .eq("user_id", userId)
    .order("created_at", { ascending: true });
  if (error || !data) return [];
  const urls = await sign(data.map((r) => r.storage_path));
  return data.map((r) => ({
    id: r.id,
    lat: r.lat,
    lng: r.lng,
    sizeM: r.size_m,
    path: r.storage_path,
    url: urls[r.storage_path] ?? "",
  }));
}

export async function addPhoto(
  userId: string,
  file: File,
  at: LatLng,
  sizeM: number,
): Promise<PhotoMemory | null> {
  const blob = await compressToSquare(file);
  const path = `${userId}/${crypto.randomUUID()}.jpg`;
  const up = await supabase.storage.from(BUCKET).upload(path, blob, {
    contentType: "image/jpeg",
    upsert: false,
  });
  if (up.error) return null;

  const { data, error } = await supabase
    .from("photo_memories")
    .insert({ user_id: userId, lat: at.lat, lng: at.lng, size_m: sizeM, storage_path: path })
    .select("id, lat, lng, size_m, storage_path")
    .single();
  if (error || !data) return null;
  const urls = await sign([path]);
  return {
    id: data.id,
    lat: data.lat,
    lng: data.lng,
    sizeM: data.size_m,
    path: data.storage_path,
    url: urls[path] ?? "",
  };
}

export async function updatePhoto(
  id: string,
  patch: { lat?: number; lng?: number; sizeM?: number },
) {
  await supabase
    .from("photo_memories")
    .update({
      ...(patch.lat !== undefined ? { lat: patch.lat } : {}),
      ...(patch.lng !== undefined ? { lng: patch.lng } : {}),
      ...(patch.sizeM !== undefined ? { size_m: patch.sizeM } : {}),
    })
    .eq("id", id);
}

export async function deletePhoto(photo: PhotoMemory) {
  await supabase.storage.from(BUCKET).remove([photo.path]);
  await supabase.from("photo_memories").delete().eq("id", photo.id);
}
