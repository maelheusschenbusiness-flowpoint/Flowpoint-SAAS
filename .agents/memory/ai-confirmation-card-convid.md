---
name: AI confirmation card conversationId
description: SSE ordering lesson — confirmation_request arrives before the conversation-ID frame; card must be self-sufficient
---

# AI confirmation card — conversationId must travel with the card

**Rule:** any confirmable-action card sent over SSE must embed the conversationId
itself; confirm handlers must prefer the card-embedded ID over any global state.

**Why:** the server emits `confirmation_request` BEFORE the final `_ai` metadata frame
that sets the global conversation ID, and the stream suspends right after the card —
so global state may never be populated for that turn. A page reload also wipes globals
while the card is restored from sessionStorage. Both cases dead-ended in « Session
perdue » with no way to confirm.

**How to apply:** when adding new confirmable tools or new confirm surfaces, keep the
card payload self-sufficient (proposalId + conversationId), persist it with chat
history, and surface confirm errors (expired/already-handled/not-found) in the thread —
never silently restore the button. New confirmable tools also need a localized preview
label in `buildConfirmationPreview` (fr/en/es) or the card shows the raw tool name; the
enumeration test over all tool registries catches omissions.
