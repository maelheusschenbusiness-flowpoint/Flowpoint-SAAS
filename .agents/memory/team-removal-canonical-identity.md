---
name: Team removal canonical identity
description: Preserve stable member identity while migrating legacy invitation records.
---

Member removal must resolve a stable canonical identity rather than trusting a legacy display or contact identifier.

**Why:** Historical invitation records can represent the same person differently. Treating one representation as authoritative can fail closed under tenant protections, preventing legitimate removal.

**How to apply:** New identity writes use the canonical form. At trust boundaries, normalize older records first, verify that the identity did not change during the protected operation, and scope every access revocation to the targeted organization.