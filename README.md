# Day Out (`places.day-out`)

Build a private outing around a saved place. Start with Café → Anchor → Restaurant,
request nearby suggestions, change categories, replace places and reorder up to
eight stops. The anchor can sit anywhere in the sequence. Save explicitly.

## Install

Requires SDK 1, `persistent-data`, Node.js 24+ and permissions `places.read` and
`search.query`. Build with `pnpm --filter @placard-official/places.day-out build`
and upload `dist/places.day-out-0.1.0.placard-module` (or ZIP) in the marketplace.
Enable it and show Day Out in navigation. The command palette offers Plan a Day Out.
After publishing, the GitHub selector is `https://github.com/JobiJoba/plugins#places.day-out`.

## Use

Choose New outing and search for an anchor. Suggest stops fills category slots
within the selected radius (5 km initially). Optional list, tag and want-to-go
filters constrain suggestions, including replacements, but never the anchor.
Candidates are selected by distance to the anchor with place ID tie-breaking.
Replacing a suggestion excludes all currently selected places, including that
suggestion. No match leaves an empty slot: widen the radius, change category,
choose a place manually or remove the slot. Manual selections can be outside the
suggestion filters. Filled slots are required to save.

Distances between consecutive stops are straight-line distances, not road lengths
or travel times. Stored hours are informational, without arrival-time checks.
Navigate opens Google Maps for the chosen destination. Outings do not change place
status, lists or visit history. There is no public sharing or timed scheduling.

Saved outings resolve current library information. Deleted or inaccessible places
appear as Place unavailable without details or navigation. Replace an unavailable
anchor before suggesting. An unchanged unavailable reference can remain while
editing other parts. Reload saved outing recovers from revision conflicts after
confirming unsaved changes can be discarded.

## MCP and HTTP

Tools: `suggest_outing`, `list_outings`, `get_outing`, `save_outing`, `delete_outing`.
Use the names exposed by the host (normally prefixed `places_day_out__`). Suggesting
never saves. A draft contains `title`, ordered `slots` (`category`, nullable
`placeId`, boolean `anchor`) and `filters` (`radiusKm`, optional `list`, `tag`,
`status: "want_to_go"`). Exactly one slot is the anchor. Radius choices: 1, 2, 5,
10, 25 km. Suggest accepts `draft` and optional `replaceIndex` (zero-based).

Save accepts `draft`, UUID `requestId`, and, for updates, `id` plus
`expectedRevision`. Delete requires `id`, `expectedRevision` and UUID `requestId`.
Reuse a request ID only for an identical retry. Saved responses include ID and
revision. Get accepts `id`; list accepts `{}`. Get and suggest include current
accessible `places`, indexed by ID. List returns outing metadata and drafts.

HTTP base: `/api/m/places.day-out`. GET `/lists`, `/tags`; POST `/search` forwards
core search filters; POST `/suggest` uses suggestion arguments; GET/POST `/outings`
lists/creates; GET/PUT/DELETE `/outings/:id` reads/updates/deletes. For PUT/DELETE,
the path supplies the ID. The HTTP page uses the same service as MCP. Ownership is
always derived from the authenticated host context. Stale mutations return 409.

## Storage and validation

Back up `ctx.dataDir/day-out.sqlite` with module writers stopped. It stores private
outings and mutation retry records, outside replaceable installed code. No place
snapshots or core database migrations are used. Plugin updates retain this data.

Run `pnpm typecheck`, `pnpm test`, `pnpm build` from the workspace. Real-host browser
coverage uses `pnpm --filter @placard-official/places.day-out test:e2e` and requires
Docker, Playwright Chromium and a built sibling `Placard` checkout (override with
`PLACARD_CORE_DIR`). Browser artifacts go to `test-results/`.
