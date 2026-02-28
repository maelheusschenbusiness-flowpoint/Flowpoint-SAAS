/* admin.js — FlowPoint AI (improved)
   - Reads ADMIN_KEY from input
   - Calls /api/admin/users, /api/admin/user/block, /api/admin/user/reset-usage
   - Sends key in header: x-admin-key
   - Computes KPIs (Users / Blocked / Ultra / Trial actifs)
*/

(function () {
  const $ = (id) => document.getElementById(id);

  function setMsg(text, isError) {
    const el = $("msg");
    if (!el) return;
    el.textContent = text || "";
    el.className = isError ? "danger" : "muted";
  }

  function adminHeaders() {
    const key = String($("key")?.value || "").trim();
    return {
      "Content-Type": "application/json",
      "x-admin-key": key,
    };
  }

  async function apiGet(url) {
    const r = await fetch(url, { headers: adminHeaders() });
    const j = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error(j.error || `Erreur API (${r.status})`);
    return j;
  }

  async function apiPost(url, body) {
    const r = await fetch(url, {
      method: "POST",
      headers: adminHeaders(),
      body: JSON.stringify(body || {}),
    });
    const j = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error(j.error || `Erreur API (${r.status})`);
    return j;
  }

  function fmtDate(d) {
    if (!d) return "—";
    try { return new Date(d).toLocaleString("fr-FR"); }
    catch { return String(d); }
  }

  function setKpi(id, val) {
    const el = $(id);
    if (el) el.textContent = String(val ?? "—");
  }

  function computeKpis(users) {
    const total = users.length;

    const blocked = users.filter(u => !!u.accessBlocked).length;
    const ultra = users.filter(u => String(u.plan || "").toLowerCase() === "ultra").length;

    const now = Date.now();
    const trialActifs = users.filter(u => {
      if (!u.trialEndsAt) return false;
      const t = new Date(u.trialEndsAt).getTime();
      return Number.isFinite(t) && t > now;
    }).length;

    setKpi("kpiUsers", total);
    setKpi("kpiBlocked", blocked);
    setKpi("kpiUltra", ultra);
    setKpi("kpiTrial", trialActifs);
  }

  async function loadUsers() {
    setMsg("Chargement…");
    const j = await apiGet("/api/admin/users");
    const list = j.users || [];

    const tb = $("tb");
    if (!tb) return;

    tb.innerHTML = "";

    for (const u of list) {
      const tr = document.createElement("tr");
      tr.innerHTML = `
        <td>${u.email || ""}</td>
        <td><b>${u.plan || ""}</b></td>
        <td>${u.accessBlocked ? "YES" : "NO"}</td>
        <td>${u.trialEndsAt ? fmtDate(u.trialEndsAt) : "—"}</td>
        <td>${u.subscriptionStatus || "—"}</td>
        <td style="white-space:nowrap">
          <button data-act="toggle">${u.accessBlocked ? "Unblock" : "Block"}</button>
          <button data-act="reset">Reset usage</button>
        </td>
      `;

      tr.querySelector('[data-act="toggle"]')?.addEventListener("click", async () => {
        try{
          await apiPost("/api/admin/user/block", { email: u.email, blocked: !u.accessBlocked });
          await loadUsers();
        }catch(e){
          setMsg(e.message, true);
        }
      });

      tr.querySelector('[data-act="reset"]')?.addEventListener("click", async () => {
        try{
          await apiPost("/api/admin/user/reset-usage", { email: u.email });
          await loadUsers();
        }catch(e){
          setMsg(e.message, true);
        }
      });

      tb.appendChild(tr);
    }

    computeKpis(list);
    setMsg(`✅ ${list.length} users chargés`);
  }

  $("load")?.addEventListener("click", () => loadUsers().catch(e => setMsg(e.message, true)));
})();
