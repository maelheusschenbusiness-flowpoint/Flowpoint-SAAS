---
name: AI provider strict mode — Phase 2
description: strictProvider=true dans aiChat/aiStream désactive le fallback cross-provider. Uniquement pour /ai/chat (choix utilisateur). Routes internes ne le passent pas.
---

## Règle
`strictProvider: true` dans `aiChat()` / `aiStream()` = le provider est la source de vérité absolue.
Si le provider est indisponible → `PROVIDER_UNAVAILABLE` (code + provider dans la réponse), jamais de fallback vers un autre fournisseur.

**Why:** Phase 2 spec — le provider choisi par l'utilisateur ne doit jamais être remplacé automatiquement.

## Application
- `/api/ai/chat` : passe `strictProvider: true` (seule route avec sélection utilisateur)
- `ai-workspace-launch`, `mission-engine`, `automation-service`, `callAIWithFallback` : ne passent PAS strictProvider → fallback chain conservé pour routes internes

## Résolution du provider dans /ai/chat
Priority : `body.provider` > `prefs.preferredProvider` > `"openai"`

## Matrice intensité
Fichier : `src/services/ai-provider-matrix.ts`
OpenAI    : Conservateur=gpt-5-mini, Équilibré=gpt-5, Performant=gpt-5
Anthropic : Conservateur=claude-haiku-4-5, Équilibré=claude-sonnet-4-6, Performant=claude-opus-4-8
Gemini    : Conservateur=gemini-3-flash-preview, Équilibré/Performant=gemini-3.1-pro-preview

## PATCH /api/ai/preferences
- 3 champs acceptés : preferredProvider, preferredModel, aiIntensity
- Champs inconnus → 400 UNKNOWN_FIELDS
- Agressif → normalisé Performant à la persistance
- Validation provider+modèle uniquement quand les deux sont fournis ensemble dans le même PATCH

## Risque résiduel
Si l'utilisateur change de provider sans changer le preferredModel, le DB peut stocker une combo invalide.
`resolveAIModel()` et `/ai/chat` ignorent correctement un preferredModel invalide pour le provider (fallback sur matrix model). Comportement correct, DB cosmétiquement incohérent.
