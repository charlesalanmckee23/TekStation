# What's New logging

The What's New panel is hand-maintained in `index.html` and displayed newest-first.

## Release workflow

1. Increment `APP_VER` in the `CHANGELOG` section.
2. Add the new changelog object as the first entry in `CHANGELOG`.
3. Include `en`, `zh`, and `es` titles plus bullet arrays so all supported languages stay complete.
4. Keep `sw.js` `CACHE_V` aligned with the deployed build when cache invalidation is needed.
5. Do not remove older changelog entries; this is the historical release log.

The unread badge compares the stored acknowledged version against `APP_VER`, so every version bump automatically causes the What's New indicator to reappear for users who have not seen that release yet.
