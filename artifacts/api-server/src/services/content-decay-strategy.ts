export type ContentDecayStrategy = {
  summary: string;
  actions: Array<{ title: string; reason: string; validation: string }>;
};

function text(value: unknown, max: number): string | null {
  if (typeof value !== "string") return null;
  const valueTrimmed = value.trim();
  return valueTrimmed.length > 0 && valueTrimmed.length <= max ? valueTrimmed : null;
}

export function parseContentDecayStrategy(value: string): ContentDecayStrategy | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(value);
  } catch {
    return null;
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return null;
  const raw = parsed as Record<string, unknown>;
  const summary = text(raw["summary"], 600);
  const actionsRaw = raw["actions"];
  if (!summary || !Array.isArray(actionsRaw) || actionsRaw.length !== 3) return null;

  const actions: ContentDecayStrategy["actions"] = [];
  for (const item of actionsRaw) {
    if (!item || typeof item !== "object" || Array.isArray(item)) return null;
    const action = item as Record<string, unknown>;
    const title = text(action["title"], 160);
    const reason = text(action["reason"], 400);
    const validation = text(action["validation"], 300);
    if (!title || !reason || !validation) return null;
    actions.push({ title, reason, validation });
  }
  if (new Set(actions.map(action => action.title.toLowerCase())).size !== actions.length) return null;
  return { summary, actions };
}
