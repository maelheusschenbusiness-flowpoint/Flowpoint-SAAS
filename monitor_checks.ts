import { pgTable, text, real, bigint, boolean } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

export const monitorChecksTable = pgTable("monitor_checks", {
  id: text("id").primaryKey(),
  monitorId: text("monitor_id").notNull(),
  checkedAt: bigint("checked_at", { mode: "number" }).notNull(),
  ok: boolean("ok").notNull(),
  latency: real("latency").notNull().default(0),
});

export const insertMonitorCheckSchema = createInsertSchema(monitorChecksTable);
export type InsertMonitorCheck = z.infer<typeof insertMonitorCheckSchema>;
export type MonitorCheck = typeof monitorChecksTable.$inferSelect;
