import { pgTable, text, real, integer, boolean, timestamp } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

export const alertRulesTable = pgTable("alert_rules", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  type: text("type").notNull(),
  operator: text("operator").notNull(),
  threshold: real("threshold").notNull(),
  durationMin: integer("duration_min").notNull().default(0),
  channels: text("channels").notNull().default('["email"]'),
  siteUrls: text("site_urls").notNull().default("[]"),
  enabled: boolean("enabled").notNull().default(true),
  createdAt: timestamp("created_at").defaultNow(),
});

export const insertAlertRuleSchema = createInsertSchema(alertRulesTable).omit({ createdAt: true });
export type InsertAlertRule = z.infer<typeof insertAlertRuleSchema>;
export type AlertRule = typeof alertRulesTable.$inferSelect;
