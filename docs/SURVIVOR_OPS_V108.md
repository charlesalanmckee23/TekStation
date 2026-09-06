# TekStation v108 — Survivor Operations System

This is an additive layer over the existing application. It does not replace the Planner, implant scanner, Creatures database, Servers/Small Tribes browser, Maps, crafting plans, or their state.

Added:
- Survivor dashboard with live build/level/encounter/Tekgram summary.
- Context-aware "Next Objective" engine from existing planner state.
- Universal persistent checklist in a separate localStorage key.
- Tame Planner backed by the existing 216-entry creature database; tracked tames can open the existing full creature details.
- Crafting chain explorer backed by the existing RECIPES dataset.
- Boss Prep workspace backed by existing ALL_BOSSES, TIERS, requirements, Element and Tek reward data.
- Quick links to the existing Servers/Find a Server and Maps experiences.
- v108 release entry in What's New.
- Service worker cache bump to asa-v108.
