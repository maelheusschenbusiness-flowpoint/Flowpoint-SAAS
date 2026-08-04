---
name: Branded export preview + WL branding
description: Unified export document system in dashboard.js, dashboard CSS var pitfalls, and PDF logo SSRF hardening
---

## Rule
All frontend exports (audits, monitors, missions, export complet) go through the module-level system in dashboard.js: `fpGetExportBranding()` → `fpBuildExportHtml()` → `window.fpOpenExportPreview()` (iframe srcdoc + Imprimer/PDF via `contentWindow.print()`). Branding = `STATE.settings.wlBranding` → localStorage `fp:wl-branding` → FlowPoint fallback. Backend PDFs (`services/pdf.ts` via reports.ts) load wlBranding **systematically**, not only when `report.white_label`.

**Why:** exports previously spent report quota per row-click, ignored WL branding, and the old "preview" had no dark-mode treatment.

## How to apply
- **`--fp-surface` does NOT exist** in the dashboard theme (defined only locally in report-view.html). Dashboard vars live in `dashboard.css`; for solid modal chrome use `--fp-bg-sidebar` (≈solid in both themes) — `--fp-bg-card` is translucent and computes near-transparent. A `var()` referencing a missing variable computes to `rgba(0,0,0,0)`.
- 4 preexisting `var(--fp-surface)` uses remain in dashboard.js (calendar ~6601/6693/6694, card ~30912) — they resolve transparent; candidates for cleanup.
- Export float panel opens via FAB `export-data` action, overview `#export-btn`, or keyboard `e`; in Playwright the synthetic body-button data-action click does NOT trigger it — use `#export-btn` after `render('overview')`.
- `pdf.ts::fetchLogoBuffer` is SSRF-hardened by reusing `middlewares/validateMonitorUrl.ts` (`isPrivateHost` + `checkDnsResolution`) + `redirect:"manual"` + 2 MB cap. Any future server-side fetch of user-configured URLs must reuse those helpers.
- PDF recommendations are derived only from the real audit row (speed/score/issues); section omitted when no data — never reintroduce fabricated recs.
