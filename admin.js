const key = document.getElementById("key");
const btn = document.getElementById("load");
const tb = document.getElementById("tb");
const msg = document.getElementById("msg");

function setMsg(t, err=false){
  msg.className = err ? "danger" : "muted";
  msg.textContent = t || "";
}

async function adminApi(path, method="GET", body=null) {
  const k = key.value.trim();
  const r = await fetch(path, {
    method,
    headers: {
      "Content-Type": "application/json",
      "x-admin-key": k
    },
    body: body ? JSON.stringify(body) : null
  });
  const d = await r.json().catch(()=> ({}));
  if (!r.ok) throw new Error(d.error || "Erreur " + r.status);
  return d;
}

function fmt(d){
  if(!d) return "-";
  try { return new Date(d).toLocaleString("fr-FR"); } catch { return String(d); }
}

btn.addEventListener("click", async ()=>{
  try{
    setMsg("Chargement…");
    const out = await adminApi("/api/admin/users");
    tb.innerHTML = "";
    for (const u of out.users) {
      const tr = document.createElement("tr");
      tr.innerHTML = `
        <td>${u.email}</td>
        <td>${u.plan}</td>
        <td>${u.accessBlocked ? "YES" : "NO"}</td>
        <td>${fmt(u.trialEndsAt)}</td>
        <td>${u.subscriptionStatus || u.lastPaymentStatus || "-"}</td>
        <td>
          <button data-email="${u.email}" data-b="${u.accessBlocked ? "0":"1"}" class="blockBtn">
            ${u.accessBlocked ? "Unblock" : "Block"}
          </button>
          <button data-email="${u.email}" class="resetBtn">Reset usage</button>
        </td>
      `;
      tb.appendChild(tr);
    }

    tb.querySelectorAll(".blockBtn").forEach(b=>{
      b.addEventListener("click", async ()=>{
        const email = b.getAttribute("data-email");
        const blocked = b.getAttribute("data-b") === "1";
        await adminApi("/api/admin/user/block", "POST", { email, blocked });
        setMsg("OK");
        btn.click();
      });
    });

    tb.querySelectorAll(".resetBtn").forEach(b=>{
      b.addEventListener("click", async ()=>{
        const email = b.getAttribute("data-email");
        await adminApi("/api/admin/user/reset-usage", "POST", { email });
        setMsg("Usage reset OK");
        btn.click();
      });
    });

    setMsg("OK");
  } catch(e){
    setMsg(e.message, true);
  }
});
