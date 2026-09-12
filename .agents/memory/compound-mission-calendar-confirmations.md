---
name: Compound mission and calendar confirmations
description: How an explicit mission-plus-calendar request remains complete without writing before confirmation.
---

For a single explicit request to create a mission with a due date and add that deadline to the FlowPoint calendar, retain both confirmation proposals. If the provider proposes only the mission, derive a calendar *proposal* from the mission title and normalized due date; never create either record before its individual confirmation.

**Why:** Provider tool selection can stop after the first requested write even when both tool families are available. Returning at the first pending confirmation also silently discarded later model tool calls, leaving the user's explicit calendar request incomplete.

**How to apply:** Restrict this companion plan to explicit mission-and-calendar wording and a valid ISO mission due date. Map mission priorities to the calendar vocabulary (`critical`→`urgent`, `medium`→`normal`) before proposing the calendar action. Confirm each proposal independently and rely on the executor result plus DB read-back before claiming success.