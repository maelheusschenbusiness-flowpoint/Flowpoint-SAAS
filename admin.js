/* admin.js — FlowPoint AI
   - Reads ADMIN_KEY from input
   - Calls /api/admin/users, /api/admin/user/block, /api/admin/user/reset-usage
   - Sends key in header: x-admin-key
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
    try { return new Date(d).toLocaleString("fr-FR"); } catch { return String(d || ""); }
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
        await apiPost("/api/admin/user/block", { email: u.email, blocked: !u.accessBlocked });
        await loadUsers();
      });

      tr.querySelector('[data-act="reset"]')?.addEventListener("click", async () => {
        await apiPost("/api/admin/user/reset-usage", { email: u.email });
        await loadUsers();
      });

      tb.appendChild(tr);
    }

    setMsg(`✅ ${list.length} users chargés`);
  }

  $("load")?.addEventListener("click", () => loadUsers().catch(e => setMsg(e.message, true)));
})();
