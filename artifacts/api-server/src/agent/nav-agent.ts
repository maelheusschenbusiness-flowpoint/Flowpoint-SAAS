/**
 * FlowPoint AI Agents — Phase 1 : navigation intelligente.
 *
 * Le modèle n'a pas de tool-calling en Phase 1 (prévu Phase 2). Il signale une
 * intention de navigation via un marqueur textuel en FIN de réponse :
 *
 *   <<<FP_NAV>>>{"destinationId":"settings-integrations","highlight":"integrations-google"}<<<END_NAV>>>
 *
 * Le serveur :
 *  1. retient le marqueur hors du flux SSE (NavMarkerFilter — jamais visible par l'utilisateur) ;
 *  2. parse + valide contre le registre (destination connue, permission, plan, ancre déclarée) ;
 *  3. émet un événement SSE structuré `action_proposal` (max 2 actions principales).
 *
 * Une route inventée par le modèle est simplement abandonnée (log) — le bouton
 * n'apparaît pas. Jamais de navigation non validée.
 */
import { logger } from "../lib/logger.js";
import type { Destination } from "./destination-registry.js";

export const NAV_MARKER_START = "<<<FP_NAV>>>";
export const NAV_MARKER_END = "<<<END_NAV>>>";

/** Section de prompt système : destinations autorisées pour CET utilisateur. */
export function buildNavPromptSection(destinations: Destination[]): string {
  if (destinations.length === 0) return "";
  const lines = destinations.map(
    (d) =>
      `- ${d.id} : ${d.description}` +
      (d.anchors.length > 0 ? ` (ancres: ${d.anchors.join(", ")})` : "")
  );
  return `
=== NAVIGATION DANS LE DASHBOARD ===
Quand l'utilisateur demande OÙ trouver, voir, modifier ou configurer quelque chose dans FlowPoint, tu peux lui proposer un bouton d'ouverture directe.

Destinations disponibles (les SEULES autorisées — n'invente JAMAIS d'autre identifiant) :
${lines.join("\n")}

Règles STRICTES :
1. Réponds d'abord normalement (explication courte du chemin, ex : "Paramètres → Intégrations").
2. Puis, à la TOUTE FIN de ta réponse, ajoute UNE seule ligne au format EXACT :
${NAV_MARKER_START}{"destinationId":"<id>","label":"<texte du bouton, max 5 mots>","highlight":"<ancre si pertinente>"}${NAV_MARKER_END}
3. "destinationId" doit être un id de la liste ci-dessus, rien d'autre.
4. "highlight" uniquement si une ancre listée correspond précisément à la demande — sinon omets le champ.
5. Jamais plus d'UN marqueur par réponse. Pas de bloc de code autour. Pas de marqueur si la question ne concerne pas la navigation dans FlowPoint.
6. Le marqueur est invisible pour l'utilisateur — n'y fais jamais référence dans ton texte ("cliquez sur le bouton ci-dessous" est correct).`;
}

/**
 * Filtre de flux : émet le texte au fil de l'eau en retenant tout début potentiel
 * de marqueur. Gère le marqueur coupé entre plusieurs chunks SSE.
 */
/**
 * Taille maximale du payload capturé entre <<<FP_NAV>>> et <<<END_NAV>>>.
 * Un marqueur légitime (1-2 actions) fait < 1 Ko ; au-delà de cette borne le
 * contenu est jeté (marker → null, jamais montré au client) et on continue de
 * tout retenir jusqu'à la fin du flux pour garantir qu'aucun fragment ne fuit.
 */
const MAX_MARKER_CAPTURE = 8192;

export class NavMarkerFilter {
  private pending = "";
  private capturing = false;
  private captured = "";
  private overflowed = false;

  /** Retourne le texte sûr à émettre pour ce chunk. */
  push(text: string): string {
    if (this.capturing) {
      if (!this.overflowed) {
        this.captured += text;
        if (this.captured.length > MAX_MARKER_CAPTURE) {
          logger.warn({ size: this.captured.length }, "[agent] nav marker payload oversized — dropped");
          this.captured = "";
          this.overflowed = true;
        }
      }
      return "";
    }
    this.pending += text;

    const idx = this.pending.indexOf(NAV_MARKER_START);
    if (idx >= 0) {
      const out = this.pending.slice(0, idx);
      this.captured = this.pending.slice(idx + NAV_MARKER_START.length);
      this.pending = "";
      this.capturing = true;
      return out;
    }

    // Retenir le plus long suffixe de pending qui est un préfixe du marqueur
    let hold = 0;
    const max = Math.min(this.pending.length, NAV_MARKER_START.length - 1);
    for (let k = max; k > 0; k--) {
      if (this.pending.endsWith(NAV_MARKER_START.slice(0, k))) { hold = k; break; }
    }
    const out = this.pending.slice(0, this.pending.length - hold);
    this.pending = this.pending.slice(this.pending.length - hold);
    return out;
  }

  /** Fin de flux : retourne le texte restant à émettre + le JSON du marqueur (ou null). */
  flush(): { remaining: string; markerJson: unknown | null } {
    if (!this.capturing) {
      const remaining = this.pending;
      this.pending = "";
      return { remaining, markerJson: null };
    }
    if (this.overflowed) return { remaining: "", markerJson: null };
    const endIdx = this.captured.indexOf(NAV_MARKER_END);
    const jsonStr = (endIdx >= 0 ? this.captured.slice(0, endIdx) : this.captured).trim();
    let markerJson: unknown | null = null;
    try { markerJson = JSON.parse(jsonStr); } catch { markerJson = null; }
    // Texte après END_NAV (le modèle ne devrait rien mettre — on l'ignore par sécurité)
    return { remaining: "", markerJson };
  }
}

/** Extraction non-stream : retire le marqueur du texte et le parse. */
export function extractNavMarker(fullText: string): { cleanText: string; markerJson: unknown | null } {
  const start = fullText.indexOf(NAV_MARKER_START);
  if (start < 0) return { cleanText: fullText, markerJson: null };
  const afterStart = fullText.slice(start + NAV_MARKER_START.length);
  const endIdx = afterStart.indexOf(NAV_MARKER_END);
  const jsonStr = (endIdx >= 0 ? afterStart.slice(0, endIdx) : afterStart).trim();
  let markerJson: unknown | null = null;
  try { markerJson = JSON.parse(jsonStr); } catch { markerJson = null; }
  const tail = endIdx >= 0 ? afterStart.slice(endIdx + NAV_MARKER_END.length) : "";
  return { cleanText: (fullText.slice(0, start) + tail).trimEnd(), markerJson };
}
