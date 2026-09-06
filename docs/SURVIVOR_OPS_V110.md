# TekStation v110 — Survivor Operations UX

Replaced the large embedded Survivor Operations dashboard in the Planner with a compact, responsive Survivor Command Bar. The original Ops modal, Planner, implant scanner, creature database, crafting data, boss data, servers and maps remain intact. The Command Bar uses existing Ops render IDs so live state continues to update. Mobile layout stacks content and enlarges touch targets. Legacy `.ops-panel` markup remains hidden to reduce regression risk.
