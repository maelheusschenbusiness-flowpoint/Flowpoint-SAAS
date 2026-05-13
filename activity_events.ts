import { pgTable, text, timestamp, jsonb } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

export const activityEventsTable = pgTable("activity_events", {
  id: text("id").primaryKey(),
  userId: text("user_id").notNull().default("mael"),
  userName: text("user_name").notNull().default("Maël H."),
  type: text("type").notNull(),
  label: text("label").notNull(),
  targetId: text("target_id"),
  targetType: text("target_type"),
  metadata: jsonb("metadata"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

export const insertActivityEventSchema = createInsertSchema(activityEventsTable).omit({ createdAt: true });
export type InsertActivityEvent = z.infer<typeof insertActivityEventSchema>;
export type ActivityEvent = typeof activityEventsTable.$inferSelect;
