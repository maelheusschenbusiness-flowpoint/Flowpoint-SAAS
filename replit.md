# FlowPoint

FlowPoint is a multi-tenant SEO and marketing operations platform. The API service lives in `artifacts/api-server`.

## User preferences

- Keep production untouched unless the user explicitly authorizes production work.
- Do not initiate real Stripe transactions without separate confirmation.
- Keep development data clean: canonical global seeds only, with no tenant or mock data.