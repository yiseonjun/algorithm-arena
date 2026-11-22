import { pgTable, uuid, text, integer, timestamp } from "drizzle-orm/pg-core";

export const appUsers = pgTable("app_users", {
  id: uuid("id").primaryKey().defaultRandom(),
  username: text("username").notNull().unique(),
  nickname: text("nickname").notNull(),
  passwordHash: text("password_hash").notNull(),
  pt: integer("pt").notNull().default(0),
  wins: integer("wins").notNull().default(0),
  losses: integer("losses").notNull().default(0),
  draws: integer("draws").notNull().default(0),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

export const ptHistory = pgTable("pt_history", {
  id: uuid("id").primaryKey().defaultRandom(),
  userId: uuid("user_id")
    .notNull()
    .references(() => appUsers.id, { onDelete: "cascade" }),
  roomId: text("room_id").notNull(),
  delta: integer("delta").notNull(),
  result: text("result").notNull(),
  ptAfter: integer("pt_after").notNull(),
  tierAfter: text("tier_after").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const matchHistory = pgTable("match_history", {
  id: uuid("id").primaryKey().defaultRandom(),
  roomId: text("room_id").notNull().unique(),
  winnerUserId: uuid("winner_user_id").references(() => appUsers.id, {
    onDelete: "set null",
  }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});
