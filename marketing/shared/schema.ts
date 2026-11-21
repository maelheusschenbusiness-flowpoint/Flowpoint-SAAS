import { sql } from "drizzle-orm";
import {
  char,
  check,
  date,
  index,
  integer,
  pgTable,
  primaryKey,
  serial,
  smallint,
  text,
  timestamp,
  uuid,
  varchar,
} from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod";

export const leads = pgTable("leads", {
  id: serial("id").primaryKey(),
  email: varchar("email", { length: 255 }).notNull(),
  name: text("name"),
  companyName: text("company_name"),
  selectedPlan: varchar("selected_plan", { length: 50 }),
  createdAt: timestamp("created_at").defaultNow(),
});

export const insertLeadSchema = createInsertSchema(leads).omit({ id: true, createdAt: true });

export type Lead = typeof leads.$inferSelect;
export type InsertLead = z.infer<typeof insertLeadSchema>;

export const conversations = pgTable("conversations", {
  id: serial("id").primaryKey(),
  title: text("title").notNull(),
  sessionToken: text("session_token"),
  createdAt: timestamp("created_at").default(sql`CURRENT_TIMESTAMP`).notNull(),
});

export const messages = pgTable("messages", {
  id: serial("id").primaryKey(),
  conversationId: integer("conversation_id").notNull().references(() => conversations.id, { onDelete: "cascade" }),
  role: text("role").notNull(),
  content: text("content").notNull(),
  createdAt: timestamp("created_at").default(sql`CURRENT_TIMESTAMP`).notNull(),
});

export const insertConversationSchema = createInsertSchema(conversations).omit({ id: true, createdAt: true });
export const insertMessageSchema = createInsertSchema(messages).omit({ id: true, createdAt: true });

export type Conversation = typeof conversations.$inferSelect;
export type InsertConversation = z.infer<typeof insertConversationSchema>;
export type Message = typeof messages.$inferSelect;
export type InsertMessage = z.infer<typeof insertMessageSchema>;

export const publicAuditQuotaCounters = pgTable(
  "public_audit_quota_counters",
  {
    quotaType: text("quota_type").notNull(),
    quotaKey: char("quota_key", { length: 64 }).notNull(),
    dayUtc: date("day_utc", { mode: "string" }).notNull(),
    used: integer("used").notNull().default(0),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => ({
    primaryKey: primaryKey({
      columns: [table.quotaType, table.quotaKey, table.dayUtc],
    }),
    quotaTypeCheck: check(
      "public_audit_quota_counters_quota_type_check",
      sql`${table.quotaType} in ('visitor', 'network', 'global')`,
    ),
    usedCheck: check(
      "public_audit_quota_counters_used_check",
      sql`${table.used} >= 0`,
    ),
    expiresAtIndex: index("public_audit_quota_counters_expires_at_idx").on(
      table.expiresAt,
    ),
  }),
);

export const publicAuditConcurrencySlots = pgTable(
  "public_audit_concurrency_slots",
  {
    slotId: smallint("slot_id").primaryKey(),
    leaseId: uuid("lease_id"),
    leaseExpiresAt: timestamp("lease_expires_at", { withTimezone: true }),
  },
);
