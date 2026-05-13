import { pgTable, text, bigint } from "drizzle-orm/pg-core";

export const auditSchedulesTable = pgTable("audit_schedules", {
  id: text("id").primaryKey(),
  url: text("url").notNull(),
  frequency: text("frequency").notNull().default("weekly"),
  nextRun: bigint("next_run", { mode: "number" }).notNull(),
  lastRun: bigint("last_run", { mode: "number" }),
  createdAt: bigint("created_at", { mode: "number" }).notNull(),
});

export type AuditSchedule = typeof auditSchedulesTable.$inferSelect;
