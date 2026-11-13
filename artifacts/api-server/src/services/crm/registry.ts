import type { CrmProviderAdapter } from "./adapter.js";
import { hubspotAdapter } from "./hubspot.js";

/** Fournisseurs reellement implementes. Les autres restent annonces mais explicitement indisponibles (501). */
const ADAPTERS: Record<string, CrmProviderAdapter> = {
  [hubspotAdapter.id]: hubspotAdapter,
};

export function getCrmAdapter(provider: string): CrmProviderAdapter | null {
  return Object.prototype.hasOwnProperty.call(ADAPTERS, provider) ? ADAPTERS[provider]! : null;
}

export function implementedCrmProviders(): string[] {
  return Object.keys(ADAPTERS);
}
