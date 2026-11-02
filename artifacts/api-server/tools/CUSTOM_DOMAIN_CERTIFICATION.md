# Custom-domain E2E certification

The target hostname is supplied through `CUSTOM_DOMAIN_CERT_HOST`. For the
internal certification, the only reserved-host candidate is:

```sh
CUSTOM_DOMAIN_CERT_HOST=custom-test.flowpoint.pro \
  pnpm --filter @workspace/api-server custom-domain:cert-preflight
```

The preflight only prints a plan. It does not call the application, database,
DNS provider, Render, or Stripe, and it does not authorize the exception.
Every other `flowpoint.pro` name continues to fail `RESERVED_DOMAIN`.

The runtime exception is default-off. It requires all of these independent
server-side checks: `CUSTOM_DOMAIN_QA_CERT_EXCEPTION_ENABLED=true`, Stripe TEST
mode with a test key, Render's injected Test service name and URL, the exact
authorized Render service ID/name configured server-side, a successful
read-only Render API identity check, and the active organization row marked
`is_internal_qa=true` for the fixed QA organization UUID. Browser input cannot
select the organization or service.

## Required sequence

1. Keep the `RESERVED_DOMAIN` validation in place for all client claims and all
   production traffic. The only exception candidate is the exact
   `custom-test.flowpoint.pro` hostname, and only for the fixed internal QA org
   on the verified Render Test service.
2. Preserve the authenticated admin role and Ultra entitlement checks. Create
   the claim through the authenticated API and retrieve its generated
   ownership token. This creates a pending application record, but must not
   contact Render.
3. After the user adds that exact TXT record, verify ownership. A missing or
   mismatched TXT must return `DOMAIN_TXT_NOT_VERIFIED`; Render provisioning
   must not be called.
4. Stop before Render provisioning until the user separately approves it.
   Never use Production or Stripe LIVE, and do not purchase anything.
5. After approval and ownership proof, verify the Render CNAME, HTTPS/TLS, and
   organization route. A session from a different organization must be rejected.
6. Before deleting anything, present the exact cleanup operations and wait for
   approval.
7. After certification, disable the server-side exception flag. Domain removal
   remains a separate approval-gated cleanup action.

Automated checks cover the reserved-domain rejection, required admin and
entitlement checks, TXT-before-Render ordering, organization-scoped lookups,
and rejection of a session belonging to another organization.
