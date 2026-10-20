export const WORKSPACE_MISSION_CATEGORIES = [
  "seo",
  "performance",
  "content",
  "local_seo",
  "conversion",
  "reporting",
  "monitoring",
  "analytics",
] as const;

export type WorkspaceMissionCategory = (typeof WORKSPACE_MISSION_CATEGORIES)[number];

export interface WorkspaceLaunchRoadmapStep {
  priority: number;
  label: string;
  impact: string;
  tag: string;
}

export interface WorkspaceLaunchMission {
  title: string;
  category: WorkspaceMissionCategory;
  priority: number;
  impact: string;
  effort: string;
}

export interface WorkspaceLaunchOutput {
  strategy: string;
  roadmap: WorkspaceLaunchRoadmapStep[];
  missions: WorkspaceLaunchMission[];
}

function boundedText(value: unknown, maxLength: number): string | null {
  if (typeof value !== "string") return null;
  const normalized = value.trim();
  return normalized.length > 0 && normalized.length <= maxLength ? normalized : null;
}

function hasCompletePriorities(values: number[], count: number): boolean {
  return values.length === count &&
    new Set(values).size === count &&
    values.every(priority => Number.isInteger(priority) && priority >= 1 && priority <= count);
}

export function parseWorkspaceLaunchOutput(text: string): WorkspaceLaunchOutput | null {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    return null;
  }

  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  const candidate = raw as Record<string, unknown>;
  const strategy = boundedText(candidate["strategy"], 4000);
  const roadmapInput = candidate["roadmap"];
  const missionsInput = candidate["missions"];
  if (!strategy || !Array.isArray(roadmapInput) || roadmapInput.length !== 5 ||
      !Array.isArray(missionsInput) || missionsInput.length !== 12) return null;

  const roadmap: WorkspaceLaunchRoadmapStep[] = [];
  for (const value of roadmapInput) {
    if (!value || typeof value !== "object" || Array.isArray(value)) return null;
    const row = value as Record<string, unknown>;
    const label = boundedText(row["label"], 240);
    const impact = boundedText(row["impact"], 160);
    const tag = boundedText(row["tag"], 60);
    if (!label || !impact || !tag || typeof row["priority"] !== "number") return null;
    roadmap.push({ priority: row["priority"], label, impact, tag });
  }

  const allowedCategories = new Set<string>(WORKSPACE_MISSION_CATEGORIES);
  const missions: WorkspaceLaunchMission[] = [];
  for (const value of missionsInput) {
    if (!value || typeof value !== "object" || Array.isArray(value)) return null;
    const row = value as Record<string, unknown>;
    const title = boundedText(row["title"], 240);
    const impact = boundedText(row["impact"], 160);
    const effort = boundedText(row["effort"], 40);
    const category = typeof row["category"] === "string" ? row["category"].trim().toLowerCase() : "";
    if (!title || !impact || !effort || !allowedCategories.has(category) || typeof row["priority"] !== "number") return null;
    missions.push({ title, category: category as WorkspaceMissionCategory, priority: row["priority"], impact, effort });
  }

  if (!hasCompletePriorities(roadmap.map(step => step.priority), 5) ||
      !hasCompletePriorities(missions.map(mission => mission.priority), 12)) return null;

  return {
    strategy,
    roadmap: roadmap.sort((a, b) => a.priority - b.priority),
    missions: missions.sort((a, b) => a.priority - b.priority),
  };
}
