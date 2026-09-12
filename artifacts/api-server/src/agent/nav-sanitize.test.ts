/**
 * nav-sanitize.test.ts — Task #608 fix 1 : fuite du protocole FP_NAV dans le chat.
 *
 * Le marqueur <<<FP_NAV>>>{json}<<<END_NAV>>> ne doit JAMAIS atteindre le rendu
 * utilisateur : il est extrait (→ action_proposal) puis toute trace est supprimée.
 *
 * Couvre :
 *  - stripNavMarkers : blocs complets, marqueurs orphelins, débuts tronqués
 *  - sanitizeNavText : texte + FP_NAV → texte propre + markerJson parsé
 *  - NavMarkerFilter : streaming avec marqueur coupé entre chunks
 *  - Marqueur en MILIEU de phrase (le cas de fuite observé en production)
 */

import { describe, it, expect } from "vitest";
import {
  stripNavMarkers,
  sanitizeNavText,
  extractNavMarker,
  NavMarkerFilter,
  NAV_MARKER_START,
  NAV_MARKER_END,
} from "./nav-agent.js";

const MARKER = `${NAV_MARKER_START}{"destinationId":"missions","params":{}}${NAV_MARKER_END}`;

describe("stripNavMarkers", () => {
  it("retire un bloc complet en fin de texte", () => {
    const out = stripNavMarkers(`Voici vos missions.\n${MARKER}`);
    expect(out).toBe("Voici vos missions.");
    expect(out).not.toContain("FP_NAV");
  });

  it("retire un bloc complet en MILIEU de phrase (cas de fuite production)", () => {
    const out = stripNavMarkers(`Vos missions ${MARKER} sont à jour.`);
    expect(out).not.toContain("FP_NAV");
    expect(out).not.toContain("END_NAV");
    expect(out).toContain("Vos missions");
    expect(out).toContain("sont à jour.");
  });

  it("retire plusieurs blocs", () => {
    const out = stripNavMarkers(`A ${MARKER} B ${MARKER} C`);
    expect(out).not.toContain("FP_NAV");
    expect(out).toContain("A");
    expect(out).toContain("C");
  });

  it("retire un marqueur de début orphelin (tronqué) jusqu'à la fin", () => {
    const out = stripNavMarkers(`Réponse utile. ${NAV_MARKER_START}{"destinationId":"mis`);
    expect(out).toBe("Réponse utile.");
  });

  it("retire un marqueur de fin orphelin", () => {
    const out = stripNavMarkers(`Texte ${NAV_MARKER_END} suite`);
    expect(out).not.toContain("END_NAV");
  });

  it("retire un PRÉFIXE PARTIEL du délimiteur d'ouverture en fin de texte (réponse tronquée)", () => {
    // Chaque point de troncature possible du délimiteur (≥ 2 caractères)
    for (let len = 2; len < NAV_MARKER_START.length; len++) {
      const partial = NAV_MARKER_START.slice(0, len);
      const out = stripNavMarkers(`Réponse utile. ${partial}`);
      expect(out, `préfixe tronqué "${partial}"`).toBe("Réponse utile.");
    }
  });

  it("retire un préfixe partiel du délimiteur de FIN en fin de texte", () => {
    const out = stripNavMarkers(`${NAV_MARKER_START}{"destinationId":"missions"}<<<END_NA`);
    expect(out).toBe("");
  });

  it("ne mutile pas un '<' isolé légitime en fin de texte", () => {
    expect(stripNavMarkers("La condition est a <")).toBe("La condition est a <");
  });

  it("laisse intact un texte sans marqueur", () => {
    expect(stripNavMarkers("Bonjour, votre score est 82.")).toBe("Bonjour, votre score est 82.");
    expect(stripNavMarkers("")).toBe("");
  });
});

describe("sanitizeNavText — texte + FP_NAV → texte propre + payload de navigation", () => {
  it("extrait le JSON du marqueur ET nettoie le texte (base de l'action_proposal)", () => {
    const { cleanText, markerJson } = sanitizeNavText(`Voici vos missions.\n${MARKER}`);
    expect(cleanText).toBe("Voici vos missions.");
    expect(cleanText).not.toContain("FP_NAV");
    expect(markerJson).toEqual({ destinationId: "missions", params: {} });
  });

  it("marqueur en milieu de phrase : JSON extrait, texte sans aucune trace", () => {
    const { cleanText, markerJson } = sanitizeNavText(`Vos missions ${MARKER} sont prêtes.`);
    expect(markerJson).toEqual({ destinationId: "missions", params: {} });
    expect(cleanText).not.toContain("<<<");
    expect(cleanText).not.toContain(">>>");
  });

  it("marqueur tronqué : aucun JSON, texte nettoyé quand même", () => {
    const { cleanText, markerJson } = sanitizeNavText(`Réponse. ${NAV_MARKER_START}{"destina`);
    expect(markerJson).toBeNull();
    expect(cleanText).toBe("Réponse.");
  });

  it("délimiteur d'ouverture lui-même tronqué : texte nettoyé, aucun fragment protocole", () => {
    const { cleanText, markerJson } = sanitizeNavText("Réponse. <<<FP_NAV>>");
    expect(markerJson).toBeNull();
    expect(cleanText).toBe("Réponse.");
  });

  it("JSON invalide dans le marqueur : pas de crash, texte nettoyé", () => {
    const { cleanText, markerJson } = sanitizeNavText(`Texte ${NAV_MARKER_START}pas-du-json${NAV_MARKER_END}`);
    expect(markerJson).toBeNull();
    expect(cleanText).not.toContain("FP_NAV");
  });
});

describe("extractNavMarker (chemin historique) — cohérence", () => {
  it("extrait le premier marqueur", () => {
    const { cleanText, markerJson } = extractNavMarker(`Texte ${MARKER}`);
    expect(markerJson).toEqual({ destinationId: "missions", params: {} });
    expect(cleanText.trim()).toBe("Texte");
  });
});

describe("NavMarkerFilter — streaming", () => {
  it("filtre un marqueur coupé entre plusieurs chunks", () => {
    const f = new NavMarkerFilter();
    const emitted =
      f.push("Voici vos missions. <<<FP_") +
      f.push('NAV>>>{"destinationId":"missions"') +
      f.push(',"params":{}}<<<END_') +
      f.push("NAV>>> Fin.");
    const flushed = f.flush();
    const visible = emitted + flushed.remaining;
    expect(visible).not.toContain("FP_NAV");
    expect(visible).not.toContain("END_NAV");
    expect(flushed.markerJson).toEqual({ destinationId: "missions", params: {} });
  });

  it("un flux sans marqueur passe intact", () => {
    const f = new NavMarkerFilter();
    const emitted = f.push("Bonjour ") + f.push("le score est 82.");
    const flushed = f.flush();
    expect(emitted + flushed.remaining).toBe("Bonjour le score est 82.");
    expect(flushed.markerJson).toBeNull();
  });
});
