import { computeQtyAddonExtras } from "../lib/plans.js";

export interface GbpLocationBatch<T> {
  accountId: string;
  locations: T[];
}

const BASE_LOCATIONS_PER_ACCOUNT = 10;
const MAX_GBP_ACCOUNTS = 3;

export function selectGbpLocations<T>(
  batches: GbpLocationBatch<T>[],
  addons: Record<string, boolean | number>,
): Array<{ accountId: string; location: T }> {
  const limitedBatches = batches.slice(0, MAX_GBP_ACCOUNTS);
  const extraSlots = computeQtyAddonExtras(addons)["gbpLocations"] ?? 0;
  const selected: Array<{ accountId: string; location: T }> = [];

  // Preserve the existing baseline: up to 10 locations from each of 3 accounts.
  for (const batch of limitedBatches) {
    for (const location of batch.locations.slice(0, BASE_LOCATIONS_PER_ACCOUNT)) {
      selected.push({ accountId: batch.accountId, location });
    }
  }

  // Allocate purchased slots round-robin so one account cannot consume the
  // entire extra capacity before other linked GBP accounts are considered.
  const offsets = limitedBatches.map(() => BASE_LOCATIONS_PER_ACCOUNT);
  while (selected.length < MAX_GBP_ACCOUNTS * BASE_LOCATIONS_PER_ACCOUNT + extraSlots) {
    let added = false;
    for (let i = 0; i < limitedBatches.length; i++) {
      const batch = limitedBatches[i]!;
      const location = batch.locations[offsets[i]!];
      if (location === undefined) continue;
      selected.push({ accountId: batch.accountId, location });
      offsets[i] = offsets[i]! + 1;
      added = true;
      if (selected.length >= MAX_GBP_ACCOUNTS * BASE_LOCATIONS_PER_ACCOUNT + extraSlots) break;
    }
    if (!added) break;
  }
  return selected;
}
