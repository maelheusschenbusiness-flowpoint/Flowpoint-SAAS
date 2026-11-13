export type QuotaSnapshot = { allowed: boolean; used: number; limit: number; available?: boolean };
export type QuotaResource = "audits" | "monitors" | "reports" | "exports" | "seats";
export type QuotaGateResult =
  | { status: "allowed"; quota: QuotaSnapshot }
  | { status: "exceeded"; quota: QuotaSnapshot }
  | { status: "unavailable"; error: unknown };

export async function resolveQuotaGate(
  check: (resource: QuotaResource, orgId: string) => Promise<QuotaSnapshot>,
  resource: QuotaResource,
  orgId: string,
): Promise<QuotaGateResult> {
  try {
    const quota = await check(resource, orgId);
    if (quota.available === false) return { status: "unavailable", error: new Error("Quota data unavailable") };
    return quota.allowed ? { status: "allowed", quota } : { status: "exceeded", quota };
  } catch (error) {
    return { status: "unavailable", error };
  }
}
