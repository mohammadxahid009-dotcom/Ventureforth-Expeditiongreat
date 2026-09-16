import { createInsertSchema } from "drizzle-zod";
import { index, pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core";
import { z } from "zod/v4";

export const friendProfilesTable = pgTable("friend_profiles", {
  userId: text("user_id").primaryKey(),
  displayName: text("display_name").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true })
    .notNull()
    .defaultNow()
    .$onUpdate(() => new Date()),
});

export const friendRequestsTable = pgTable(
  "friend_requests",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    senderUserId: text("sender_user_id").notNull(),
    receiverUserId: text("receiver_user_id").notNull(),
    status: text("status").notNull().default("pending"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    respondedAt: timestamp("responded_at", { withTimezone: true }),
  },
  (table) => [
    index("friend_requests_sender_idx").on(table.senderUserId, table.status),
    index("friend_requests_receiver_idx").on(table.receiverUserId, table.status),
  ],
);

export const insertFriendProfileSchema = createInsertSchema(friendProfilesTable).omit({
  createdAt: true,
  updatedAt: true,
});
export type InsertFriendProfile = z.infer<typeof insertFriendProfileSchema>;
export type FriendProfile = typeof friendProfilesTable.$inferSelect;
export type FriendRequest = typeof friendRequestsTable.$inferSelect;