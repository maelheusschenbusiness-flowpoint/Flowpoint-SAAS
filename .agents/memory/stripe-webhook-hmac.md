---
name: Stripe webhook HMAC signing
description: How to construct a valid Stripe-Signature header for local webhook simulation
---

## Rule
Use the **raw `whsec_...` string** directly as the HMAC-SHA256 key — no stripping of the `whsec_` prefix, no base64 decode.

```js
function makeStripeSignature(rawBody, secret, timestamp) {
  const t = timestamp || Math.floor(Date.now() / 1000);
  const payload = `${t}.${rawBody}`;
  const sig = crypto.createHmac('sha256', secret)   // secret = entire "whsec_..." string
    .update(payload, 'utf8').digest('hex');
  return { header: `t=${t},v1=${sig}`, timestamp: t };
}
```

**Why:** Stripe's NodeCryptoProvider does `crypto.createHmac('sha256', secret).update(payload).digest('hex')` where `secret` is the raw `whsec_...` value passed by the user. The `whsec_` prefix is part of the HMAC key material, not a base64 encoding wrapper.

**How to apply:** Any test that posts simulated webhook events to a server running real Stripe webhook verification must use this exact construction. Stripping `whsec_` or base64-decoding it both produce a mismatched signature and a 400 rejection.
