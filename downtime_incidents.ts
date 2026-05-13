import { pgTable, text, bigint, timestamp } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

export const downtimeIncidentsTable = pgTable("downtime_incidents", {
  monitorId: text("monitor_id").primaryKey(),
  downSince: bigint("down_since", { mode: "number" }).notNull(),
  updatedAt: timestamp("updated_at").defaultNow(),
});

export const insertDowntimeIncidentSchema = createInsertSchema(downtimeIncidentsTable).omit({ updatedAt: true });
export type InsertDowntimeIncident = z.infer<typeof insertDowntimeIncidentSchema>;
export type DowntimeIncident = typeof downtimeIncidentsTable.$inferSelect;
