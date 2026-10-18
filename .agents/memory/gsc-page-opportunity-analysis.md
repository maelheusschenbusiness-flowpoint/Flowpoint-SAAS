---
name: GSC page opportunity analysis
description: Data boundaries for Search Console-based SEO opportunity features.
---

Use daily page-level Search Console data to find pages losing clicks or rankings. Do not claim keyword cannibalization from the current GSC tables: keyword data is keyed by organization, keyword, and date, while page data is keyed by organization, page, and date; the synchronization does not preserve a query-to-page join.

**Why:** aggregating independent query and page tables cannot establish which query caused a specific page's metrics.

**How to apply:** compare page metrics across explicit date windows; add query-page-level source data before building cannibalization detection.
