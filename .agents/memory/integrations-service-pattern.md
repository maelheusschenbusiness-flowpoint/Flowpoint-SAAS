---
name: integrations-service signatures
description: Correct function signatures and table for integrations-service.ts; what changed and why
---

# integrations-service.ts — Correct Signatures

**Why this file:** routes/integrations.ts imports these exact signatures. Wrong signatures = webhooks silently break.

## Table
- Use `automation_integrations` (NOT `webhook_integrations`)
- Required columns: name, platform, endpoint_url, secret_key, events (JSONB), headers (JSONB), timeout_ms, max_retries, retry_enabled, active, success_count, failure_count, last_triggered, updated_at, metadata
- These were added via ALTER TABLE in init-automation.ts

## Function signatures (as imported by routes/integrations.ts)
```ts
createIntegration(orgId: string, plan: string, data: { name, type?, platform?, endpointUrl?, webhookUrl?, events?, metadata?, headers?, retryEnabled?, maxRetries? })
dispatchEvent(event: string, payload: Record<string, unknown>, orgId: string)  // note: orgId is 3rd param
testIntegration(id: string, orgId: string)
processIncomingWebhook(token: string, body: Record<string,unknown>, orgId: string)
getIntegrationStats(orgId: string)
getIntegrationLimit(plan: string)
```

## Platform payload format
- Slack: { text, blocks } — no HMAC
- Discord: { username, embeds } — no HMAC
- Others (Zapier/Make/n8n/custom): { event, data, timestamp, source, platform } + X-FlowPoint-Signature HMAC

## missions INSERT
- Use `source_type` column (NOT `source`) + `source_data JSONB`
