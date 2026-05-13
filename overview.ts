import { Router } from "express";
import { db, monitorsTable, auditsTable, reportsTable, teamMembersTable } from "@workspace/db";
import { eq, sql } from "drizzle-orm";

const router = Router();

router.get("/overview", async (_req, res) => {
  const [monitorsAgg] = await db.select({
    total: sql<number>`count(*)::int`,
    down: sql<number>`count(*) filter (where status = 'down')::int`,
  }).from(monitorsTable);

  const [auditsAgg] = await db.select({
    total: sql<number>`count(*)::int`,
    avgScore: sql<number>`round(avg(score))::int`,
  }).from(auditsTable);

  const [reportsCount] = await db.select({
    total: sql<number>`count(*)::int`,
  }).from(reportsTable);

  const [teamCount] = await db.select({
    total: sql<number>`count(*)::int`,
  }).from(teamMembersTable);

  res.json({
    avgScore: auditsAgg?.avgScore ?? 0,
    monitorsDown: monitorsAgg?.down ?? 0,
    monitorsTotal: monitorsAgg?.total ?? 0,
    auditsTotal: auditsAgg?.total ?? 0,
    reportsTotal: reportsCount?.total ?? 0,
    teamTotal: teamCount?.total ?? 0,
  });
});

export default router;
