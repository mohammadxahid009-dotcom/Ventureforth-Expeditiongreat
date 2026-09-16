import { Router, type IRouter } from "express";
import { and, desc, eq, ilike, inArray, ne, or } from "drizzle-orm";
import {
  AcceptFriendRequestParams,
  AcceptFriendRequestResponse,
  CreateFriendRequestBody,
  CreateFriendRequestResponse,
  DeclineFriendRequestParams,
  DeclineFriendRequestResponse,
  GetFriendsOverviewResponse,
  RemoveFriendQueryParams,
  SearchFriendProfilesQueryParams,
  SearchFriendProfilesResponse,
  UpsertFriendProfileBody,
  UpsertFriendProfileResponse,
} from "@workspace/api-zod";
import { db, friendProfilesTable, friendRequestsTable } from "@workspace/db";
import { requireSupabaseUser, type AuthenticatedRequest } from "../middleware/supabase-auth";

const router: IRouter = Router();
const pending = "pending";
const accepted = "accepted";
const declined = "declined";

function requestShape(
  request: typeof friendRequestsTable.$inferSelect,
  profiles: Map<string, string>,
) {
  return {
    id: request.id,
    senderUserId: request.senderUserId,
    senderDisplayName: profiles.get(request.senderUserId) ?? "Explorer",
    receiverUserId: request.receiverUserId,
    receiverDisplayName: profiles.get(request.receiverUserId) ?? "Explorer",
    status: request.status as "pending" | "accepted" | "declined",
    createdAt: request.createdAt,
    respondedAt: request.respondedAt,
  };
}

async function ensureProfile(userId: string, email?: string) {
  const [existing] = await db
    .select()
    .from(friendProfilesTable)
    .where(eq(friendProfilesTable.userId, userId))
    .limit(1);
  if (existing) return existing;

  const localPart = email?.split("@")[0]?.replace(/[^a-zA-Z0-9 _-]/g, "").trim();
  const fallback = (localPart || `Explorer ${userId.slice(0, 4)}`).slice(0, 32);
  const [created] = await db
    .insert(friendProfilesTable)
    .values({ userId, displayName: fallback })
    .returning();
  return created;
}

async function loadProfiles(userIds: string[]) {
  if (userIds.length === 0) return new Map<string, string>();
  const rows = await db
    .select()
    .from(friendProfilesTable)
    .where(inArray(friendProfilesTable.userId, userIds));
  return new Map(rows.map((profile) => [profile.userId, profile.displayName]));
}

router.get("/friends", requireSupabaseUser, async (req, res): Promise<void> => {
  const { id, email } = (req as AuthenticatedRequest).user;
  const profile = await ensureProfile(id, email);
  const [incoming, outgoing, acceptedRequests] = await Promise.all([
    db
      .select()
      .from(friendRequestsTable)
      .where(and(eq(friendRequestsTable.receiverUserId, id), eq(friendRequestsTable.status, pending)))
      .orderBy(desc(friendRequestsTable.createdAt)),
    db
      .select()
      .from(friendRequestsTable)
      .where(and(eq(friendRequestsTable.senderUserId, id), eq(friendRequestsTable.status, pending)))
      .orderBy(desc(friendRequestsTable.createdAt)),
    db
      .select()
      .from(friendRequestsTable)
      .where(
        and(
          eq(friendRequestsTable.status, accepted),
          or(eq(friendRequestsTable.senderUserId, id), eq(friendRequestsTable.receiverUserId, id)),
        ),
      )
      .orderBy(desc(friendRequestsTable.respondedAt)),
  ]);

  const relatedIds = [
    ...new Set(
      [...incoming, ...outgoing, ...acceptedRequests].flatMap((request) => [
        request.senderUserId,
        request.receiverUserId,
      ]),
    ),
  ];
  const profiles = await loadProfiles([id, ...relatedIds]);
  const friends = acceptedRequests.map((request) => {
    const otherUserId =
      request.senderUserId === id ? request.receiverUserId : request.senderUserId;
    return {
      userId: otherUserId,
      displayName: profiles.get(otherUserId) ?? "Explorer",
      connectedAt: request.respondedAt ?? request.createdAt,
    };
  });

  res.json(
    GetFriendsOverviewResponse.parse({
      profile,
      friends,
      incoming: incoming.map((request) => requestShape(request, profiles)),
      outgoing: outgoing.map((request) => requestShape(request, profiles)),
    }),
  );
});

router.put("/friends/profile", requireSupabaseUser, async (req, res): Promise<void> => {
  const { id } = (req as AuthenticatedRequest).user;
  const parsed = UpsertFriendProfileBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "Display name must be 2–32 characters." });
    return;
  }
  const displayName = parsed.data.displayName.trim().replace(/\s+/g, " ");
  if (displayName.length < 2 || displayName.length > 32) {
    res.status(400).json({ error: "Display name must be 2–32 characters." });
    return;
  }

  const [profile] = await db
    .insert(friendProfilesTable)
    .values({ userId: id, displayName })
    .onConflictDoUpdate({
      target: friendProfilesTable.userId,
      set: { displayName, updatedAt: new Date() },
    })
    .returning();
  res.json(UpsertFriendProfileResponse.parse(profile));
});

router.get("/friends/search", requireSupabaseUser, async (req, res): Promise<void> => {
  const { id } = (req as AuthenticatedRequest).user;
  const parsed = SearchFriendProfilesQueryParams.safeParse(req.query);
  if (!parsed.success) {
    res.status(400).json({ error: "Search must be between 2 and 40 characters." });
    return;
  }
  const query = parsed.data.q.trim();
  const results = await db
    .select({ userId: friendProfilesTable.userId, displayName: friendProfilesTable.displayName })
    .from(friendProfilesTable)
    .where(and(ilike(friendProfilesTable.displayName, `%${query}%`), ne(friendProfilesTable.userId, id)))
    .orderBy(friendProfilesTable.displayName)
    .limit(20);
  res.json(SearchFriendProfilesResponse.parse(results));
});

router.post("/friends/requests", requireSupabaseUser, async (req, res): Promise<void> => {
  const { id, email } = (req as AuthenticatedRequest).user;
  const parsed = CreateFriendRequestBody.safeParse(req.body);
  if (!parsed.success || parsed.data.receiverUserId === id) {
    res.status(400).json({ error: "Choose another explorer." });
    return;
  }
  const receiver = await ensureProfile(parsed.data.receiverUserId);
  if (!receiver) {
    res.status(404).json({ error: "Explorer not found." });
    return;
  }
  await ensureProfile(id, email);

  const existing = await db
    .select()
    .from(friendRequestsTable)
    .where(
      or(
        and(
          eq(friendRequestsTable.senderUserId, id),
          eq(friendRequestsTable.receiverUserId, receiver.userId),
        ),
        and(
          eq(friendRequestsTable.senderUserId, receiver.userId),
          eq(friendRequestsTable.receiverUserId, id),
        ),
      ),
    )
    .orderBy(desc(friendRequestsTable.createdAt))
    .limit(1);
  if (existing[0]?.status === accepted) {
    res.status(400).json({ error: "You are already friends." });
    return;
  }
  if (existing[0]?.status === pending) {
    res.status(400).json({ error: "A friend request is already waiting." });
    return;
  }

  const [created] = await db
    .insert(friendRequestsTable)
    .values({ senderUserId: id, receiverUserId: receiver.userId })
    .returning();
  const profiles = await loadProfiles([id, receiver.userId]);
  res.status(201).json(CreateFriendRequestResponse.parse(requestShape(created, profiles)));
});

router.post(
  "/friends/requests/:requestId/accept",
  requireSupabaseUser,
  async (req, res): Promise<void> => {
    const { id } = (req as AuthenticatedRequest).user;
    const parsed = AcceptFriendRequestParams.safeParse(req.params);
    if (!parsed.success) {
      res.status(400).json({ error: "Invalid friend request." });
      return;
    }
    const [request] = await db
      .select()
      .from(friendRequestsTable)
      .where(
        and(
          eq(friendRequestsTable.id, parsed.data.requestId),
          eq(friendRequestsTable.receiverUserId, id),
          eq(friendRequestsTable.status, pending),
        ),
      )
      .limit(1);
    if (!request) {
      res.status(404).json({ error: "Friend request not found." });
      return;
    }
    const [updated] = await db
      .update(friendRequestsTable)
      .set({ status: accepted, respondedAt: new Date() })
      .where(eq(friendRequestsTable.id, request.id))
      .returning();
    const profiles = await loadProfiles([updated.senderUserId]);
    res.json(
      AcceptFriendRequestResponse.parse({
        userId: updated.senderUserId,
        displayName: profiles.get(updated.senderUserId) ?? "Explorer",
        connectedAt: updated.respondedAt ?? updated.createdAt,
      }),
    );
  },
);

router.post(
  "/friends/requests/:requestId/decline",
  requireSupabaseUser,
  async (req, res): Promise<void> => {
    const { id } = (req as AuthenticatedRequest).user;
    const parsed = DeclineFriendRequestParams.safeParse(req.params);
    if (!parsed.success) {
      res.status(400).json({ error: "Invalid friend request." });
      return;
    }
    const [request] = await db
      .select()
      .from(friendRequestsTable)
      .where(
        and(
          eq(friendRequestsTable.id, parsed.data.requestId),
          eq(friendRequestsTable.receiverUserId, id),
          eq(friendRequestsTable.status, pending),
        ),
      )
      .limit(1);
    if (!request) {
      res.status(404).json({ error: "Friend request not found." });
      return;
    }
    const [updated] = await db
      .update(friendRequestsTable)
      .set({ status: declined, respondedAt: new Date() })
      .where(eq(friendRequestsTable.id, request.id))
      .returning();
    const profiles = await loadProfiles([updated.senderUserId, updated.receiverUserId]);
    res.json(DeclineFriendRequestResponse.parse(requestShape(updated, profiles)));
  },
);

router.delete("/friends", requireSupabaseUser, async (req, res): Promise<void> => {
  const { id } = (req as AuthenticatedRequest).user;
  const parsed = RemoveFriendQueryParams.safeParse(req.query);
  if (!parsed.success || parsed.data.userId === id) {
    res.status(400).json({ error: "Invalid friend." });
    return;
  }
  const [request] = await db
    .select()
    .from(friendRequestsTable)
    .where(
      and(
        eq(friendRequestsTable.status, accepted),
        or(
          and(
            eq(friendRequestsTable.senderUserId, id),
            eq(friendRequestsTable.receiverUserId, parsed.data.userId),
          ),
          and(
            eq(friendRequestsTable.senderUserId, parsed.data.userId),
            eq(friendRequestsTable.receiverUserId, id),
          ),
        ),
      ),
    )
    .limit(1);
  if (!request) {
    res.status(404).json({ error: "Friend not found." });
    return;
  }
  await db.delete(friendRequestsTable).where(eq(friendRequestsTable.id, request.id));
  res.sendStatus(204);
});

export default router;