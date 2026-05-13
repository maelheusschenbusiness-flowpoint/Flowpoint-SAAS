import { pgTable, text, boolean, timestamp } from "drizzle-orm/pg-core";

export const teamMessagesTable = pgTable("team_messages", {
  id: text("id").primaryKey(),
  channel: text("channel").notNull().default("general"),
  from: text("from").notNull(),
  text: text("text").notNull(),
  self: boolean("self").notNull().default(false),
  createdAt: timestamp("created_at").defaultNow(),
});

export type TeamMessage = typeof teamMessagesTable.$inferSelect;
