import { pgTable, text, integer, timestamp } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

export const shareTokensTable = pgTable("share_tokens", {
  token: text("token").primaryKey(),
  reportId: text("report_id").notNull(),
  reportJson: text("report_json").notNull(),
  brandingJson: text("branding_json").notNull(),
  auditsJson: text("audits_json").notNull(),
  meetingNotesJson: text("meeting_notes_json").default("[]"),
  views: integer("views").notNull().default(0),
  createdAt: text("created_at").notNull(),
  expiresAt: text("expires_at").notNull(),
  updatedAt: timestamp("updated_at").defaultNow(),
});

export const insertShareTokenSchema = createInsertSchema(shareTokensTable).omit({ updatedAt: true });
export type InsertShareToken = z.infer<typeof insertShareTokenSchema>;
export type ShareTokenRow = typeof shareTokensTable.$inferSelect;
