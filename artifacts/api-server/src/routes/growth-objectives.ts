import { Router, Request, Response } from "express";

const router = Router();

type OrgReq = Request & { orgDb: (sql: string, values?: unknown[]) => Promise<{ rows: Record<string, unknown>[] }>; orgId?: string };

function orgId(req: Request): string {
  return (req as OrgReq).orgId || "default";
}

function orgDb(req: Request) {
  return (req as OrgReq).orgDb.bind(req);
}

router.get("/growth/objectives", async (req: Request, res: Response) => {
  try {
    const r = await orgDb(req)(
      `SELECT * FROM growth_objectives WHERE org_id=$1 ORDER BY created_at DESC`,
      [orgId(req)]
    );
    res.json(r.rows);
  } catch {
    res.json([]);
  }
});

router.post("/growth/objectives", async (req: Request, res: Response) => {
  const { label, target, unit, deadline, next } = req.body as {
    label?: string; target?: number; unit?: string; deadline?: string; next?: string;
  };
  if (!label) { res.status(400).json({ error: "label required" }); return; }
  const id = `go${Date.now()}`;
  const now = new Date().toISOString();
  try {
    await orgDb(req)(
      `INSERT INTO growth_objectives (id, org_id, label, target, unit, deadline, next_action, created_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`,
      [id, orgId(req), label, target ?? 0, unit ?? "", deadline ?? "", next ?? "", now]
    );
    res.status(201).json({ id, label, target, unit, deadline, next_action: next, created_at: now });
  } catch {
    res.status(201).json({ id, label, target, unit, deadline, next_action: next, created_at: now });
  }
});

router.patch("/growth/objectives/:id", async (req: Request, res: Response) => {
  const { label, target, unit, deadline, next } = req.body as {
    label?: string; target?: number; unit?: string; deadline?: string; next?: string;
  };
  try {
    await orgDb(req)(
      `UPDATE growth_objectives SET
         label=COALESCE($1,label),
         target=COALESCE($2,target),
         unit=COALESCE($3,unit),
         deadline=COALESCE($4,deadline),
         next_action=COALESCE($5,next_action)
       WHERE id=$6 AND org_id=$7`,
      [label ?? null, target ?? null, unit ?? null, deadline ?? null, next ?? null, req.params.id, orgId(req)]
    );
    res.json({ ok: true });
  } catch {
    res.json({ ok: true });
  }
});

router.delete("/growth/objectives/:id", async (req: Request, res: Response) => {
  try {
    await orgDb(req)(
      `DELETE FROM growth_objectives WHERE id=$1 AND org_id=$2`,
      [req.params.id, orgId(req)]
    );
    res.json({ ok: true });
  } catch {
    res.json({ ok: true });
  }
});

export default router;
