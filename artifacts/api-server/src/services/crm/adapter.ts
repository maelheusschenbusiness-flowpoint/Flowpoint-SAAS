/**
 * Contrat d'un fournisseur CRM. Chaque CRM (HubSpot, puis Salesforce, Pipedrive...) implemente
 * cette interface ; le coeur (OAuth, stockage chiffre, synchronisation idempotente, webhooks,
 * quotas) ne connait que ce contrat.
 */
export interface CrmTokenSet {
  accessToken: string;
  refreshToken: string;
  expiresInSeconds: number;
  scope?: string;
  accountId?: string;
}

export interface CrmContact {
  /** Identifiant stable chez le CRM : cle d'idempotence (org, provider, externalId). */
  externalId: string;
  name: string;
  email: string | null;
  phone: string | null;
  status: string | null;
  updatedAt: string | null;
}

export interface CrmContactPage {
  contacts: CrmContact[];
  nextCursor: string | null;
}

export interface CrmWebhookCheck {
  rawBody: Buffer;
  method: string;
  /** URL publique complete telle que signee par le fournisseur. */
  url: string;
  headers: Record<string, string | string[] | undefined>;
  now?: number;
}

export interface CrmProviderAdapter {
  readonly id: string;
  readonly scopes: readonly string[];
  /** Vrai si les identifiants applicatifs (client id/secret) sont presents. */
  isConfigured(): boolean;
  buildAuthUrl(state: string, redirectUri: string): string;
  exchangeCode(code: string, redirectUri: string): Promise<CrmTokenSet>;
  refresh(refreshToken: string): Promise<CrmTokenSet>;
  fetchContacts(accessToken: string, cursor: string | null, limit: number): Promise<CrmContactPage>;
  fetchContact(accessToken: string, externalId: string): Promise<CrmContact | null>;
  /** Revocation du jeton chez le fournisseur (au mieux : un echec ne bloque pas la deconnexion locale). */
  revoke?(refreshToken: string): Promise<void>;
  /** Valide la signature d'un webhook entrant ; echec ferme. */
  verifyWebhook(check: CrmWebhookCheck): boolean;
  /** Extrait les identifiants de contacts concernes par un webhook (deja authentifie). */
  parseWebhook(rawBody: Buffer): { eventId: string; contactExternalId: string | null; portalId: string | null }[];
}

export class CrmProviderError extends Error {
  constructor(readonly code: string, message: string, readonly status?: number) {
    super(message);
    this.name = "CrmProviderError";
  }
}
