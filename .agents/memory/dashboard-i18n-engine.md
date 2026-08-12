---
name: Dashboard i18n engine — source-restore + composite fpT
description: Durable rules for keeping the dashboard 100% translatable
---

# Dashboard i18n rules

The rule: **every visible French string must either be an exact FP_I18N catalog key, or be built from fpT() fragments in the renderer.**

**Why:** fpApplyTranslations does exact-match lookup on trimmed text-node values. Template literals interpolating counts/values (`${n} sites surveillés`) produce runtime strings that never match a catalog key — they stay French in non-FR mode.

**How to apply:**
- Static strings → add to FP_I18N_EN (curated) or FP_I18N_EN_EXTRA (auto-generated, merged without overriding curated keys). Catalog keys must be runtime text values, never source-code fragments — auto-generated sweeps of the JS source produce dead keys with `${…}`/ternaries that translate nothing.
- Composite/dynamic strings → split into stable French fragments each wrapped in `fpT('…')` at render time. Cover EVERY branch (e.g. both the ok-state and incident-state variants of a status sentence) and chip/action arrays.
- Dynamically injected DOM outside `#fp-page` must be listed as a translation root inside fpApplyTranslations (notif dropdown was missed once); check the roots list when adding a new floating panel.
- The engine is source-restore: node.__fpSrc holds canonical French; FR→X→FR round-trips are lossless. Never write already-translated text back as source.
- showToast translates programmatically via catalog lookup before escHtml — toast messages must be exact catalog keys.
- Diagnostic sweeps using a TreeWalker also capture inline `<script>` source text inside innerHTML — filter nodes whose parent is SCRIPT to avoid false positives.
- `isGA4Connected` means "ready to query" (active property required); tokens-only discovery state is exposed as `discovering` via getGA4ConnectionStatus — never treat tokens alone as queryable.
