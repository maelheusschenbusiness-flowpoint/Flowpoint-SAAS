---
name: Billing quote — server is the single source
description: Why all pricing lives server-side, and the rule that a quote is only truthful for one collection mechanism.
---

# The server quote is the only source of money

**Rule:** no browser surface may compute, store, or hardcode a plan price, an
add-on price, or a plan-inclusion rule. The server owns the catalogue and the
quote; the frontend renders them.

**Why:** parallel catalogues in the checkout, pricing and dashboard surfaces had
each drifted from the server definitions independently. Real consequences found
in one pass: an add-on displayed as "included, 0 €" while Stripe charged it
monthly; an add-on advertised as bundled with a mid-tier plan when it was
top-tier only; a feature sold as a paid add-on to customers who already had it.
Every divergence is a billing dispute.

**How to apply:** change a price in the server plan definitions only. If a
frontend needs a new display field, add it to the catalogue payload — never
re-declare it client-side. When the catalogue is unavailable, render `—` and
block activation; never fall back to a guessed amount.

---

## A quote is only truthful for ONE collection mechanism

The two checkout paths defer different things, so the quote must be told which
one will collect the money:

- **Own Payment Element** — we charge the add-ons up front and start their
  subscription one period later. A plan trial does **not** defer add-ons.
- **Hosted Checkout Session** (`mode: "subscription"`) — Stripe's
  `trial_period_days` suspends the *entire* subscription, recurring add-ons
  included. Only one-time items are taken on day zero.

**Why:** a single mechanism-blind quote is necessarily wrong for one of the two
paths, and it is wrong in the direction that under-states the debit.

**How to apply:** pass the mechanism into the quote and derive `billedToday`
per line from it. Never hardcode trial days at the Stripe call site — read them
from the quote, so an ineligible customer cannot be granted a free period the
quote already charged them for.

---

## "Due today" and "what our PaymentIntent collects" are different numbers

A plan subscription raises its **own** Stripe invoice when created. So the plan
can be due today and still have to be excluded from our PaymentIntent.

**Why:** collecting the plan in the PaymentIntent *and* letting the new
subscription invoice it debits the customer's first month twice. Modelling only
one total makes this invisible: the displayed figure looks right while the card
is hit twice.

**How to apply:** keep two figures — the total debited today (for display) and
the amount our own intent collects (plan excluded). When the latter is zero,
fall through to a SetupIntent so the card is saved and the subscription invoice
does the charging.

---

## Trial eligibility is a server decision

Decide it from the authenticated org's billing state, never from the browser,
and treat a **failed lookup as not eligible** so a quote can never under-state
what will be charged.
