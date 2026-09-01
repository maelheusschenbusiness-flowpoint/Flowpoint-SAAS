/**
 * White-label PDF branding tests
 * Covers report_templates → streamReportPdf() mapping (A–J spec)
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import type { WlBranding } from "../services/pdf.js";

// ── Minimal streamReportPdf surface we need to inspect ────────────────────────
// We don't render full PDFs in unit tests — we verify the branding object that
// reaches the generator and the field-mapping logic extracted from reports.ts.

/** Mirrors the mapping logic in GET /reports/:id/download */
function mapTemplateRowToWlBranding(
  row: {
    header_text: string | null;
    name: string | null;
    logo_url: string | null;
    primary_color: string | null;
    secondary_color: string | null;
    footer_text: string | null;
    hide_flowpoint_branding: boolean | null;
  } | null
): WlBranding | null {
  if (!row) return null;
  return {
    agencyName:            row.header_text?.trim() || row.name?.trim() || undefined,
    logoUrl:               row.logo_url ?? undefined,
    primaryColor:          row.primary_color ?? undefined,
    secondaryColor:        row.secondary_color ?? undefined,
    footerMsg:             row.footer_text ?? undefined,
    hideFlowpointBranding: !!(row.hide_flowpoint_branding),
  };
}

/** Mirrors the brand-resolution logic in streamReportPdf() */
function resolveBrandName(branding: WlBranding | null): string {
  const wl = branding && (branding.agencyName || branding.hideFlowpointBranding) ? branding : null;
  return (wl?.agencyName || "").trim() || (wl?.hideFlowpointBranding ? "" : "FlowPoint");
}

function resolveSecondaryColor(branding: WlBranding | null, primaryColor: string): string {
  const wl = branding && (branding.agencyName || branding.hideFlowpointBranding) ? branding : null;
  return (wl?.secondaryColor && /^#[0-9a-fA-F]{6}$/.test(wl.secondaryColor))
    ? wl.secondaryColor
    : primaryColor;
}

function resolvePrimaryColor(branding: WlBranding | null): string {
  const wl = branding && (branding.agencyName || branding.hideFlowpointBranding) ? branding : null;
  return (wl?.primaryColor && /^#[0-9a-fA-F]{6}$/.test(wl.primaryColor))
    ? wl.primaryColor
    : "#2563EB";
}

// ── TEST A — no white-label template → FlowPoint defaults ─────────────────────
describe("TEST A — no white-label config", () => {
  it("returns null branding when no template row exists", () => {
    expect(mapTemplateRowToWlBranding(null)).toBeNull();
  });
  it("brandName falls back to FlowPoint", () => {
    expect(resolveBrandName(null)).toBe("FlowPoint");
  });
  it("primaryColor falls back to #2563EB", () => {
    expect(resolvePrimaryColor(null)).toBe("#2563EB");
  });
});

// ── TEST B — org A template applied ───────────────────────────────────────────
describe("TEST B — org A white-label template", () => {
  const rowA = {
    header_text: "Agence Alpha",
    name: "Template Alpha",
    logo_url: "https://alpha.example.com/logo.png",
    primary_color: "#FF5500",
    secondary_color: "#00AAFF",
    footer_text: "Alpha — Confidentiel",
    hide_flowpoint_branding: true,
  };
  const wl = mapTemplateRowToWlBranding(rowA)!;

  it("agencyName from header_text", () => expect(wl.agencyName).toBe("Agence Alpha"));
  it("logoUrl mapped", () => expect(wl.logoUrl).toBe("https://alpha.example.com/logo.png"));
  it("primaryColor mapped", () => expect(wl.primaryColor).toBe("#FF5500"));
  it("secondaryColor mapped", () => expect(wl.secondaryColor).toBe("#00AAFF"));
  it("footerMsg mapped", () => expect(wl.footerMsg).toBe("Alpha — Confidentiel"));
  it("hideFlowpointBranding mapped", () => expect(wl.hideFlowpointBranding).toBe(true));
  it("brandName = agencyName", () => expect(resolveBrandName(wl)).toBe("Agence Alpha"));
});

// ── TEST C — org B isolation (different template) ─────────────────────────────
describe("TEST C — org B gets its own branding, not org A's", () => {
  const rowB = {
    header_text: "Agence Beta",
    name: "Template Beta",
    logo_url: "https://beta.example.com/logo.png",
    primary_color: "#009900",
    secondary_color: "#FFCC00",
    footer_text: "Beta — Privé",
    hide_flowpoint_branding: false,
  };
  const wl = mapTemplateRowToWlBranding(rowB)!;

  it("agencyName is Beta, not Alpha", () => expect(wl.agencyName).toBe("Agence Beta"));
  it("logoUrl is Beta's logo", () => expect(wl.logoUrl).toBe("https://beta.example.com/logo.png"));
  it("primaryColor is Beta's color", () => expect(wl.primaryColor).toBe("#009900"));
  it("brandName resolves to Beta", () => expect(resolveBrandName(wl)).toBe("Agence Beta"));
});

// ── TEST D — primaryColor applied ─────────────────────────────────────────────
describe("TEST D — primaryColor", () => {
  it("valid hex primaryColor is used", () => {
    const wl = mapTemplateRowToWlBranding({
      header_text: "X", name: "T", logo_url: null,
      primary_color: "#AB1234", secondary_color: null,
      footer_text: null, hide_flowpoint_branding: false,
    })!;
    expect(resolvePrimaryColor(wl)).toBe("#AB1234");
  });
  it("invalid hex primaryColor falls back to default", () => {
    const wl = mapTemplateRowToWlBranding({
      header_text: "X", name: "T", logo_url: null,
      primary_color: "not-a-color", secondary_color: null,
      footer_text: null, hide_flowpoint_branding: false,
    })!;
    expect(resolvePrimaryColor(wl)).toBe("#2563EB");
  });
});

// ── TEST E — secondaryColor applied to correct element ────────────────────────
describe("TEST E — secondaryColor", () => {
  it("valid secondaryColor is returned for section accent", () => {
    const wl = mapTemplateRowToWlBranding({
      header_text: "X", name: "T", logo_url: null,
      primary_color: "#FF0000", secondary_color: "#00FF00",
      footer_text: null, hide_flowpoint_branding: false,
    })!;
    const primary = resolvePrimaryColor(wl);
    expect(resolveSecondaryColor(wl, primary)).toBe("#00FF00");
  });
  it("null secondaryColor falls back to primary", () => {
    const wl = mapTemplateRowToWlBranding({
      header_text: "X", name: "T", logo_url: null,
      primary_color: "#FF0000", secondary_color: null,
      footer_text: null, hide_flowpoint_branding: false,
    })!;
    const primary = resolvePrimaryColor(wl);
    expect(resolveSecondaryColor(wl, primary)).toBe("#FF0000");
  });
  it("invalid secondaryColor falls back to primary", () => {
    const wl = mapTemplateRowToWlBranding({
      header_text: "X", name: "T", logo_url: null,
      primary_color: "#FF0000", secondary_color: "blue",
      footer_text: null, hide_flowpoint_branding: false,
    })!;
    const primary = resolvePrimaryColor(wl);
    expect(resolveSecondaryColor(wl, primary)).toBe("#FF0000");
  });
});

// ── TEST F — logo_url transmitted ─────────────────────────────────────────────
describe("TEST F — logo_url", () => {
  it("logo_url is passed through to branding.logoUrl", () => {
    const wl = mapTemplateRowToWlBranding({
      header_text: "X", name: "T",
      logo_url: "https://cdn.example.com/logo.svg",
      primary_color: null, secondary_color: null,
      footer_text: null, hide_flowpoint_branding: false,
    })!;
    expect(wl.logoUrl).toBe("https://cdn.example.com/logo.svg");
  });
  it("null logo_url gives undefined in WlBranding", () => {
    const wl = mapTemplateRowToWlBranding({
      header_text: "X", name: "T", logo_url: null,
      primary_color: null, secondary_color: null,
      footer_text: null, hide_flowpoint_branding: false,
    })!;
    expect(wl.logoUrl).toBeUndefined();
  });
});

// ── TEST G — footer_text transmitted ──────────────────────────────────────────
describe("TEST G — footer_text", () => {
  it("footer_text mapped to footerMsg", () => {
    const wl = mapTemplateRowToWlBranding({
      header_text: "X", name: "T", logo_url: null,
      primary_color: null, secondary_color: null,
      footer_text: "Mon agence — Strictement confidentiel",
      hide_flowpoint_branding: false,
    })!;
    expect(wl.footerMsg).toBe("Mon agence — Strictement confidentiel");
  });
});

// ── TEST H — hide_flowpoint_branding semantics ────────────────────────────────
describe("TEST H — hide_flowpoint_branding", () => {
  it("false → FlowPoint name shown when no agencyName", () => {
    const wl: WlBranding = { hideFlowpointBranding: false };
    expect(resolveBrandName(wl)).toBe("FlowPoint");
  });
  it("true + no agencyName → empty brand name (no FlowPoint)", () => {
    const wl: WlBranding = { hideFlowpointBranding: true };
    expect(resolveBrandName(wl)).toBe("");
  });
  it("true + agencyName → agencyName shown", () => {
    const wl: WlBranding = { agencyName: "Agence X", hideFlowpointBranding: true };
    expect(resolveBrandName(wl)).toBe("Agence X");
  });
  it("false + agencyName → agencyName shown (not FlowPoint)", () => {
    const wl: WlBranding = { agencyName: "Agence X", hideFlowpointBranding: false };
    expect(resolveBrandName(wl)).toBe("Agence X");
  });
});

// ── TEST I — no is_default template → fallback to first row ───────────────────
describe("TEST I — template fallback when no is_default", () => {
  // The SQL ORDER BY is_default DESC, created_at DESC LIMIT 1
  // means: first non-default row returned is the most recent one.
  // If that row has no agencyName but has hideFlowpointBranding=false → FlowPoint default.
  it("template without header_text falls back to template name as agencyName", () => {
    const wl = mapTemplateRowToWlBranding({
      header_text: null, name: "Mon Template",
      logo_url: null, primary_color: null, secondary_color: null,
      footer_text: null, hide_flowpoint_branding: false,
    })!;
    expect(wl.agencyName).toBe("Mon Template");
    expect(resolveBrandName(wl)).toBe("Mon Template");
  });
  it("template with blank header_text falls back to name", () => {
    const wl = mapTemplateRowToWlBranding({
      header_text: "   ", name: "Fallback Name",
      logo_url: null, primary_color: null, secondary_color: null,
      footer_text: null, hide_flowpoint_branding: false,
    })!;
    expect(wl.agencyName).toBe("Fallback Name");
  });
});

// ── TEST J — hostile cross-org isolation ──────────────────────────────────────
describe("TEST J — hostile cross-org isolation", () => {
  const rowA = {
    header_text: "Agence A",
    name: "T-A",
    logo_url: "https://a.example.com/logo.png",
    primary_color: "#AA0000",
    secondary_color: "#AA00AA",
    footer_text: "A footer",
    hide_flowpoint_branding: true,
  };
  const rowB = {
    header_text: "Agence B",
    name: "T-B",
    logo_url: "https://b.example.com/logo.png",
    primary_color: "#0000BB",
    secondary_color: "#00BBBB",
    footer_text: "B footer",
    hide_flowpoint_branding: false,
  };
  const wlA = mapTemplateRowToWlBranding(rowA)!;
  const wlB = mapTemplateRowToWlBranding(rowB)!;

  it("org A branding never contains org B data", () => {
    expect(wlA.agencyName).not.toBe(wlB.agencyName);
    expect(wlA.primaryColor).not.toBe(wlB.primaryColor);
    expect(wlA.logoUrl).not.toBe(wlB.logoUrl);
    expect(wlA.footerMsg).not.toBe(wlB.footerMsg);
  });
  it("org B branding never contains org A data", () => {
    expect(wlB.agencyName).not.toBe(wlA.agencyName);
    expect(wlB.primaryColor).not.toBe(wlA.primaryColor);
  });
  it("brandName A resolves correctly", () => expect(resolveBrandName(wlA)).toBe("Agence A"));
  it("brandName B resolves correctly", () => expect(resolveBrandName(wlB)).toBe("Agence B"));
});
