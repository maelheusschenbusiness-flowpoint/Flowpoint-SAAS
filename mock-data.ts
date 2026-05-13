export const MOCK_ME = {
  firstName: "Maël",
  plan: "Pro",
  role: "owner",
  org: { name: "Flowpoint Agency" },
  subscriptionStatus: "active",
  trialEndsAt: null,
  stripeCustomerId: process.env["STRIPE_CUSTOMER_ID"] || "",
  usage: {
    audit: { used: 87, limit: 300 },
    pdf: { used: 34, limit: 300 },
    exports: { used: 12, limit: 300 },
    monitor: { used: 18, limit: 50 },
  },
  addons: {
    whiteLabel: true,
    prioritySupport: true,
    customDomain: false,
    extraSeats: 2,
    monitorsPack50: 0,
  },
};

export const MOCK_AUDITS = [
  { id: "a1", url: "https://boulangerie-martin.fr",   score: 82, status: "ok",    speed: 91, date: "2026-05-03T09:12:00Z", issues: 3 },
  { id: "a2", url: "https://restaurant-lesoleil.com", score: 61, status: "warn",  speed: 67, date: "2026-05-02T14:30:00Z", issues: 11 },
  { id: "a3", url: "https://plombier-paris.fr",       score: 38, status: "error", speed: 44, date: "2026-05-01T10:00:00Z", issues: 22 },
  { id: "a4", url: "https://coiffeur-lyon.com",       score: 75, status: "ok",    speed: 88, date: "2026-04-30T16:45:00Z", issues: 5 },
  { id: "a5", url: "https://pharmacie-centre.fr",     score: 55, status: "warn",  speed: 59, date: "2026-04-29T11:20:00Z", issues: 14 },
  { id: "a6", url: "https://garage-auto-nice.com",    score: 90, status: "ok",    speed: 95, date: "2026-04-28T08:00:00Z", issues: 1 },
];

export const MOCK_MONITORS = [
  { id: "m1", name: "Boulangerie Martin",   url: "https://boulangerie-martin.fr",   status: "up" as const,   uptime: 99.8, latency: 142, lastCheck: "2 min", alertEmail: "" },
  { id: "m2", name: "Restaurant Le Soleil", url: "https://restaurant-lesoleil.com", status: "down" as const, uptime: 97.2, latency: 0,   lastCheck: "5 min", alertEmail: "" },
  { id: "m3", name: "Plombier Paris",       url: "https://plombier-paris.fr",       status: "up" as const,   uptime: 99.9, latency: 98,  lastCheck: "1 min", alertEmail: "" },
  { id: "m4", name: "Coiffeur Lyon",        url: "https://coiffeur-lyon.com",       status: "warn" as const, uptime: 98.5, latency: 890, lastCheck: "3 min", alertEmail: "" },
  { id: "m5", name: "Pharmacie Centre",     url: "https://pharmacie-centre.fr",     status: "up" as const,   uptime: 100,  latency: 67,  lastCheck: "2 min", alertEmail: "" },
];

export const MOCK_REPORTS = [
  { id: "r1", name: "Rapport Avril 2026 — Boulangerie Martin", type: "PDF", date: "2026-04-30T10:00:00Z", pages: 8,  shared: true,  auditId: "a1", whiteLabel: true,  pdfReady: true },
  { id: "r2", name: "Rapport SEO Mensuel — Restaurant",        type: "PDF", date: "2026-04-28T15:30:00Z", pages: 12, shared: false, auditId: "a2", whiteLabel: false, pdfReady: true },
];

export const MOCK_TEAM = [
  { id: "t1", name: "Maël H.",    email: "mael@flowpoint.pro",   role: "owner",   joined: "2025-12-01" },
  { id: "t2", name: "Sophie M.", email: "sophie@flowpoint.pro", role: "manager", joined: "2026-01-15" },
  { id: "t3", name: "Lucas D.",  email: "lucas@client.com",     role: "viewer",  joined: "2026-03-10" },
];
