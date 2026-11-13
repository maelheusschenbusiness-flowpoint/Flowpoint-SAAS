export const LOCAL_PRESENCE_FIELDS = [
  { key: "title", label: "Nom de l’établissement", priority: "high" },
  { key: "primaryCategory", label: "Catégorie principale", priority: "high" },
  { key: "phone", label: "Téléphone", priority: "high" },
  { key: "websiteUri", label: "Site web", priority: "high" },
  { key: "address", label: "Adresse ou zone desservie", priority: "medium" },
  { key: "regularHours", label: "Horaires d’ouverture", priority: "medium" },
  { key: "description", label: "Description de l’établissement", priority: "medium" },
] as const;

export type LocalPresenceFieldKey = typeof LOCAL_PRESENCE_FIELDS[number]["key"];

function hasValue(value: unknown): boolean {
  if (typeof value === "string") return value.trim().length > 0;
  if (Array.isArray(value)) return value.length > 0;
  if (value && typeof value === "object") return Object.keys(value).length > 0;
  return false;
}

function fieldValue(key: LocalPresenceFieldKey, data: Record<string, unknown>): unknown {
  if (key === "title") return data["title"];
  if (key === "primaryCategory") {
    const category = data["primaryCategory"] as Record<string, unknown> | undefined;
    return category?.["displayName"] ?? category?.["name"];
  }
  if (key === "phone") {
    const phones = data["phoneNumbers"] as Record<string, unknown> | undefined;
    return phones?.["primaryPhone"];
  }
  if (key === "websiteUri") return data["websiteUri"];
  if (key === "address") {
    const address = data["storefrontAddress"] as Record<string, unknown> | undefined;
    const serviceArea = data["serviceArea"];
    return address?.["addressLines"] ?? address?.["locality"] ?? serviceArea;
  }
  if (key === "regularHours") {
    const hours = data["regularHours"] as Record<string, unknown> | undefined;
    return hours?.["periods"];
  }
  const profile = data["profile"] as Record<string, unknown> | undefined;
  return profile?.["description"];
}

export function analyzeLocalPresence(
  rawData: unknown,
  trackedFields: unknown = LOCAL_PRESENCE_FIELDS.map(field => field.key),
) {
  const data = rawData && typeof rawData === "object" && !Array.isArray(rawData)
    ? rawData as Record<string, unknown>
    : {};
  const selected = new Set(
    Array.isArray(trackedFields)
      ? trackedFields.filter((key): key is LocalPresenceFieldKey =>
          LOCAL_PRESENCE_FIELDS.some(field => field.key === key))
      : LOCAL_PRESENCE_FIELDS.map(field => field.key),
  );
  const fields = LOCAL_PRESENCE_FIELDS
    .filter(field => selected.has(field.key))
    .map(field => ({
      ...field,
      complete: hasValue(fieldValue(field.key, data)),
    }));
  const complete = fields.filter(field => field.complete).length;
  return {
    score: fields.length ? Math.round((complete / fields.length) * 100) : 0,
    completedFields: complete,
    totalFields: fields.length,
    fields,
    opportunities: fields.filter(field => !field.complete).map(field => ({
      key: field.key,
      title: `Compléter : ${field.label}`,
      priority: field.priority,
      evidence: "Cette information est absente des données synchronisées de la fiche GBP.",
    })),
  };
}
