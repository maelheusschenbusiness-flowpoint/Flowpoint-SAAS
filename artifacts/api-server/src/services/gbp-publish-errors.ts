/**
 * Codes d'erreur de publication GBP, avec un message FR exploitable tel quel par l'UI.
 * Statut HTTP associé : voir routes/gbp-posts.ts.
 */
export const GBP_PUBLISH_ERRORS: Record<string, string> = {
  GOOGLE_NOT_CONNECTED: "Google Business Profile n’est pas connecté. Reconnectez votre compte Google, puis relancez la publication.",
  GOOGLE_AUTH_FAILED: "L’autorisation Google a expiré ou été refusée. Reconnectez votre compte Google, puis relancez la publication.",
  GBP_API_FORBIDDEN: "Google refuse la publication pour cet établissement (droits insuffisants ou fiche non vérifiée).",
  GBP_API_RATE_LIMITED: "Google limite temporairement les publications. Réessayez dans quelques minutes.",
  GBP_API_UNAVAILABLE: "L’API Google Business Profile est momentanément indisponible. Le post n’a PAS été publié ; réessayez plus tard.",
  GBP_API_REJECTED: "Google a rejeté ce post (contenu ou paramètres invalides). Le post n’a PAS été publié.",
  GBP_PUBLISH_FAILED: "La publication Google a échoué. Le post n’a PAS été publié.",
  GBP_PUBLISH_INTERRUPTED: "La publication a été interrompue avant la réponse de Google. Vérifiez la fiche Google avant de relancer.",
  GBP_SCHEDULE_MISSED: "L’heure de publication programmée est passée de plus de 24 h sans exécution : le post n’a pas été publié.",
  GBP_POST_MANUAL_APPROVAL_REQUIRED: "Ce post programmé n’a pas été validé manuellement.",
  GBP_LOCATION_REQUIRED: "Choisissez un établissement connecté avant de publier.",
  GBP_LOCATION_NOT_VERIFIED_FOR_ORG: "Cet établissement n’est pas rattaché à votre compte Google connecté.",
  GBP_POST_TYPE_NOT_SUPPORTED_FOR_PUBLISH: "L’API Google connectée ne prend pas en charge ce format de post.",
  GBP_EVENT_SCHEDULE_REQUIRED: "Le titre, l’heure de début et l’heure de fin sont requis pour un événement.",
  GBP_EVENT_SCHEDULE_INVALID: "L’heure de fin de l’événement doit être postérieure à son début.",
  GBP_MEDIA_URL_INVALID: "Les images doivent être des URL HTTPS publiques.",
};

/** Erreur de publication portant un code stable et un message affichable. */
export class GbpPublishError extends Error {
  constructor(public readonly code: string) {
    super(code);
    this.name = "GbpPublishError";
  }
  get userMessage(): string { return GBP_PUBLISH_ERRORS[this.code] ?? GBP_PUBLISH_ERRORS["GBP_PUBLISH_FAILED"]!; }
}
