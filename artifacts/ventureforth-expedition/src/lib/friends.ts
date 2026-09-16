import { supabase } from "@/integrations/supabase/client";

export type FriendProfile = {
  userId: string;
  displayName: string;
  createdAt: string;
  updatedAt: string;
};

export type Friend = {
  userId: string;
  displayName: string;
  connectedAt: string;
};

export type FriendRequest = {
  id: string;
  senderUserId: string;
  senderDisplayName: string;
  receiverUserId: string;
  receiverDisplayName: string;
  status: "pending" | "accepted" | "declined";
  createdAt: string;
  respondedAt: string | null;
};

export type FriendsOverview = {
  profile: FriendProfile;
  friends: Friend[];
  incoming: FriendRequest[];
  outgoing: FriendRequest[];
};

export type FriendSearchResult = {
  userId: string;
  displayName: string;
};

async function request<T>(path: string, init: RequestInit = {}): Promise<T> {
  const {
    data: { session },
  } = await supabase.auth.getSession();
  if (!session) throw new Error("Your session has expired. Please sign in again.");

  const headers = new Headers(init.headers);
  headers.set("Authorization", `Bearer ${session.access_token}`);
  headers.set("apikey", import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY);
  headers.set("x-supabase-url", import.meta.env.VITE_SUPABASE_URL);
  if (init.body && !headers.has("Content-Type")) headers.set("Content-Type", "application/json");

  const response = await fetch(`/api${path}`, { ...init, headers });
  if (!response.ok) {
    const body = (await response.json().catch(() => null)) as { error?: string } | null;
    throw new Error(body?.error || "Could not reach the expedition network.");
  }
  if (response.status === 204) return undefined as T;
  return (await response.json()) as T;
}

export const getFriendsOverview = () => request<FriendsOverview>("/friends");

export const searchFriendProfiles = (query: string) =>
  request<FriendSearchResult[]>(`/friends/search?q=${encodeURIComponent(query)}`);

export const saveFriendProfile = (displayName: string) =>
  request<FriendProfile>("/friends/profile", {
    method: "PUT",
    body: JSON.stringify({ displayName }),
  });

export const sendFriendRequest = (receiverUserId: string) =>
  request<FriendRequest>("/friends/requests", {
    method: "POST",
    body: JSON.stringify({ receiverUserId }),
  });

export const acceptFriendRequest = (requestId: string) =>
  request<Friend>(`/friends/requests/${requestId}/accept`, { method: "POST" });

export const declineFriendRequest = (requestId: string) =>
  request<FriendRequest>(`/friends/requests/${requestId}/decline`, { method: "POST" });

export const removeFriend = (userId: string) =>
  request<void>(`/friends?userId=${encodeURIComponent(userId)}`, { method: "DELETE" });