import { Router } from "express";

const router = Router();

interface Mission {
  id: string;
  title: string;
  status: "todo" | "doing" | "done";
  impact: string;
  effort: string;
  category: string;
  date: string;
  priority: number;
}

const store: Mission[] = [
  { id: "m1", title: "Optimiser les Core Web Vitals (LCP < 2.5s)", status: "todo", impact: "Élevé", effort: "Moyen", category: "Technique", date: new Date(Date.now() + 2 * 86400000).toISOString().slice(0, 10), priority: 1 },
  { id: "m2", title: "Créer 3 articles de blog ciblant les mots-clés locaux", status: "doing", impact: "Élevé", effort: "Élevé", category: "Contenu", date: new Date(Date.now() + 5 * 86400000).toISOString().slice(0, 10), priority: 2 },
  { id: "m3", title: "Corriger les balises méta manquantes (12 pages)", status: "todo", impact: "Moyen", effort: "Faible", category: "SEO On-page", date: new Date(Date.now() + 1 * 86400000).toISOString().slice(0, 10), priority: 3 },
  { id: "m4", title: "Compléter le profil Google Business Profile", status: "done", impact: "Élevé", effort: "Faible", category: "Local SEO", date: new Date(Date.now() - 2 * 86400000).toISOString().slice(0, 10), priority: 4 },
  { id: "m5", title: "Acquérir 5 backlinks depuis des annuaires locaux", status: "todo", impact: "Moyen", effort: "Moyen", category: "Netlinking", date: new Date(Date.now() + 7 * 86400000).toISOString().slice(0, 10), priority: 5 },
];

router.get("/missions", (_req, res) => {
  res.json(store);
});

router.post("/missions", (req, res) => {
  const { title, status = "todo", impact = "Moyen", effort = "Moyen", category = "SEO", date, priority } = req.body as Partial<Mission>;
  if (!title) { res.status(400).json({ error: "title required" }); return; }
  const mission: Mission = {
    id: "m" + Date.now(),
    title,
    status: status as Mission["status"],
    impact,
    effort,
    category,
    date: date || new Date().toISOString().slice(0, 10),
    priority: priority ?? store.length + 1,
  };
  store.push(mission);
  res.status(201).json(mission);
});

router.patch("/missions/:id", (req, res) => {
  const idx = store.findIndex(m => m.id === req.params.id);
  if (idx < 0) { res.status(404).json({ error: "mission not found" }); return; }
  Object.assign(store[idx], req.body);
  res.json(store[idx]);
});

router.delete("/missions/:id", (req, res) => {
  const idx = store.findIndex(m => m.id === req.params.id);
  if (idx < 0) { res.status(404).json({ error: "mission not found" }); return; }
  store.splice(idx, 1);
  res.json({ ok: true });
});

export default router;
