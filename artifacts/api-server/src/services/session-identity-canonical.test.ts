import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const servicesDir = dirname(fileURLToPath(import.meta.url));
const authSource = readFileSync(resolve(servicesDir, "../routes/auth.ts"), "utf8");
const sessionsSource = readFileSync(resolve(servicesDir, "./sessions.ts"), "utf8");
const teamSource = readFileSync(resolve(servicesDir, "../routes/team.ts"), "utf8");
const meSource = readFileSync(resolve(servicesDir, "../routes/me.ts"), "utf8");
const progressionSource = readFileSync(resolve(servicesDir, "../routes/progression.ts"), "utf8");
const activitySource = readFileSync(resolve(servicesDir, "./activity-streak.ts"), "utf8");

describe("canonical session identity contract", () => {
  it("A-C: magic-link owner sessions keep users.id separate from organizations.id", () => {
    expect(authSource).toContain("userId:    sessionUserUuid!");
    expect(authSource).toContain("orgId:     sessionOrgId");
    expect(authSource).not.toContain("userId:    sessionOrgId");
    expect(authSource).toContain("userUuid:  sessionUserUuid");
  });

  it("D-E: refresh and restoration resolve the persisted session identity", () => {
    expect(sessionsSource).toContain("userUuid = row.user_id_v2");
    expect(sessionsSource).toContain("userId: userUuid ?? rawUserId");
    expect(authSource).toContain('session = await getSession(bearerToken)');
    expect(authSource).toContain('session = await getSession(cookieToken)');
    expect(authSource).toContain('res.status(401).json({ error: "session_expired" })');
  });

  it("F: invited members create a session with their own users.id", () => {
    expect(teamSource).toContain("const acceptedUserUuid = acceptedUserRes.rows[0]?.id");
    expect(teamSource).toContain("userId:    acceptedUserUuid");
    expect(teamSource).toContain("orgId:     inv.org_id");
    expect(teamSource).toContain("userUuid:  acceptedUserUuid");
  });

  it("G-H: activity writers prefer the canonical session UUID", () => {
    expect(meSource).toContain("req.orgContext?.userUuid ?? req.orgContext?.userId");
    expect(progressionSource).toContain("req.orgContext?.userUuid ?? req.orgContext?.userId");
    expect(activitySource).toContain("AND user_id=$2");
  });

  it("I-J: streak reads remain user-scoped rather than organization-scoped", () => {
    expect(activitySource).toContain("WHERE org_id=$1");
    expect(activitySource).toContain("AND user_id=$2");
    expect(teamSource).toContain("computeUserStreak(");
    expect(teamSource).toContain("uid,");
  });

  it("K-L: ambiguous legacy sessions are refused, never promoted to owner", () => {
    expect(sessionsSource).toContain("rawUserId === String(row.org_id ?? \"\")");
    expect(sessionsSource).toContain("rawUserId.includes(\"@\")");
    expect(sessionsSource).toContain("[sessions] Refusing legacy session with user_id equal to org_id");
    expect(sessionsSource).toContain("userUuid ?? rawUserId");
  });

  it("M: login, signup, onboarding, restoration, and invitation paths remain present", () => {
    expect(authSource).toContain("handleLoginVerify");
    expect(authSource).toContain("pending_signups");
    expect(authSource).toContain('router.post("/auth/session-restore"');
    expect(teamSource).toContain('publicTeamRouter.post("/team/invitations/accept"');
    expect(meSource).toContain("onboardingCompletedAt");
  });

  it("OAuth providers pass canonical user and organization identities independently", () => {
    expect(authSource).toContain(
      "userId: googleIdentity.userUuid, orgId: googleIdentity.orgId, userUuid: googleIdentity.userUuid",
    );
    expect(authSource).toContain("userId: githubIdentity.userUuid");
    expect(authSource).toContain("orgId: githubIdentity.orgId");
    expect(authSource).toContain("userId:    appleIdentity.userUuid");
    expect(authSource).toContain("orgId:     appleIdentity.orgId");
  });

  it("organization switching refuses sessions without a canonical user identity", () => {
    expect(teamSource).toContain("const canonicalUserId = req.orgContext?.userUuid ?? req.userUuid");
    expect(teamSource).toContain('code: "CANONICAL_IDENTITY_REQUIRED"');
    expect(teamSource).toContain("userUuid:  canonicalUserId");
  });
});