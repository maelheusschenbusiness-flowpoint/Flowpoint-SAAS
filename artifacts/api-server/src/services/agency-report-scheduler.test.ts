import { beforeEach, describe, expect, it, vi } from "vitest";

const { queryMock, connectMock, consolidateMock, portalMock, sendReportGeneratedMock, deliveryReadyMock, publicBaseUrlMock } = vi.hoisted(() => ({
  queryMock: vi.fn(),
  connectMock: vi.fn(),
  consolidateMock: vi.fn(),
  portalMock: vi.fn(),
  sendReportGeneratedMock: vi.fn(),
  deliveryReadyMock: vi.fn(() => true),
  publicBaseUrlMock: vi.fn(() => "https://agency.example.test"),
}));

vi.mock("@workspace/db", () => ({
  pool: { query: queryMock, connect: connectMock },
}));
vi.mock("./agency-reporting.js", () => ({
  createConsolidatedAgencyReport: consolidateMock,
  createAgencyCustomerPortal: portalMock,
  getAgencyPublicBaseUrl: publicBaseUrlMock,
  isAgencyReportDeliveryReady: deliveryReadyMock,
}));
vi.mock("./mailer.js", () => ({
  mailer: { sendReportGenerated: sendReportGeneratedMock },
}));

import { deliverAgencyReportSchedule } from "./agency-report-scheduler.js";

const schedule = {
  id: "agency_schedule_a",
  org_id: "org-a",
  client_name: "Client A",
  recipient_email: "client@example.test",
  audit_ids: ["audit-a", "audit-b"],
  cron_expression: "0 9 * * 1",
  timezone: "Europe/Paris",
};

describe("scheduled Agency Reporting Pack delivery", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    deliveryReadyMock.mockReturnValue(true);
    publicBaseUrlMock.mockReturnValue("https://agency.example.test");
    vi.stubEnv("PUBLIC_URL", "https://agency.example.test");
    vi.stubEnv("AGENCY_REPORT_SCHEDULER_ENABLED", "true");
    connectMock.mockResolvedValue({
      query: queryMock,
      release: vi.fn(),
    });
    queryMock.mockImplementation(async (sql: string) => (
      sql.includes("INSERT INTO agency_report_schedule_runs") ? { rows: [{ id: "claimed" }] } : { rows: [] }
    ));
    consolidateMock.mockResolvedValue({ id: "report-a", name: "Client A — Rapport multi-sites", auditCount: 2 });
    portalMock.mockResolvedValue({ id: "portal-a", token: "secure-portal-token" });
    sendReportGeneratedMock.mockResolvedValue({ ok: true, id: "mail-1" });
  });

  it("claims a persisted org-scoped run, generates the report, and mails a portal link", async () => {
    await deliverAgencyReportSchedule(schedule, new Date("2026-11-09T09:00:00.000Z"));

    expect(queryMock).toHaveBeenCalledWith("SELECT set_config('app.current_org_id', $1, true)", ["org-a"]);
    expect(consolidateMock).toHaveBeenCalledWith("org-a", "Client A", ["audit-a", "audit-b"]);
    expect(portalMock).toHaveBeenCalledWith("org-a", "Client A", ["report-a"], "system");
    expect(sendReportGeneratedMock).toHaveBeenCalledWith(expect.objectContaining({
      to: "client@example.test",
      reportName: "Client A — Rapport multi-sites",
      reportUrl: expect.stringContaining("/api/agency-portal/secure-portal-token"),
    }));
    expect(queryMock).toHaveBeenCalledWith(
      expect.stringContaining("SET status='delivered'"),
      [JSON.stringify(["report-a"]), "agency_run_agency_schedule_a_1794214800000", "org-a"],
    );
  });

  it("does not produce duplicate reports or emails if another worker already claimed that schedule slot", async () => {
    queryMock.mockImplementation(async () => ({ rows: [] }));

    await deliverAgencyReportSchedule(schedule, new Date("2026-11-09T09:00:00.000Z"));

    expect(consolidateMock).not.toHaveBeenCalled();
    expect(portalMock).not.toHaveBeenCalled();
    expect(sendReportGeneratedMock).not.toHaveBeenCalled();
  });

  it("marks a run as failed when external email delivery is unavailable", async () => {
    sendReportGeneratedMock.mockResolvedValue({ ok: false, error: "Mailer not configured" });

    await deliverAgencyReportSchedule(schedule, new Date("2026-11-09T09:00:00.000Z"));

    expect(queryMock).toHaveBeenCalledWith(
      expect.stringContaining("SET status='failed'"),
      ["Mailer not configured", "agency_run_agency_schedule_a_1794214800000", "org-a"],
    );
    expect(queryMock).toHaveBeenCalledWith(
      expect.stringContaining("last_status='failed'"),
      ["Mailer not configured", "agency_schedule_a", "org-a"],
    );
  });

  it("does not claim a run or generate reports when delivery is disabled or has no public URL", async () => {
    deliveryReadyMock.mockReturnValue(false);

    await expect(deliverAgencyReportSchedule(schedule, new Date("2026-11-09T09:00:00.000Z")))
      .rejects.toThrow("AGENCY_SCHEDULER_DISABLED_OR_PUBLIC_URL_MISSING");
    expect(queryMock).not.toHaveBeenCalled();
    expect(consolidateMock).not.toHaveBeenCalled();

    deliveryReadyMock.mockReturnValue(true);
    publicBaseUrlMock.mockImplementation(() => { throw new Error("AGENCY_PUBLIC_URL_REQUIRED"); });
    await expect(deliverAgencyReportSchedule(schedule, new Date("2026-11-09T09:00:00.000Z")))
      .rejects.toThrow("AGENCY_PUBLIC_URL_REQUIRED");
    expect(queryMock).not.toHaveBeenCalled();
    expect(consolidateMock).not.toHaveBeenCalled();
  });
});
