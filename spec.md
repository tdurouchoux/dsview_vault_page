# Spec: changes beyond `quartz.config.yaml`

Tracks modifications made under `quartz/` (or to the forked plugins) that go
beyond what's expressible in `quartz.config.yaml`. Each entry is a functional
description of what changed and how it affects the rendered page — not an
implementation walkthrough.

## `quartz/styles/custom.scss`

**Larger graph overview panel** — On content pages (desktop screens only),
the graph preview shown in the right-hand sidebar is now bigger: the sidebar
itself is wider (400px vs. the default 320px shared by the left sidebar),
and the graph box is taller (380px vs. the default 250px). The left sidebar
and mobile/tablet layouts are unaffected. Other page types that don't show
the graph (folders, tags, bases) keep the default sidebar width.

## `../dsview-vault-graph` (forked graph plugin)

**Global graph shown in the index-page preview box** — `index.md` is an
unlinked landing page (intentionally not connected to any other note), so
its "local" neighbourhood graph would render empty. On `index.md` only, the
small graph preview box now renders the global graph (all notes/topics)
instead of the local one. Clicking the expand icon still opens the same
full-screen global graph overlay as on every other page.

**Configurable initial zoom-out for the index preview** — Because the index
preview box is much smaller than the full-screen overlay it borrows its
layout from, the global graph rendered inside it appeared zoomed in (nodes
overflowing the box). Added a `graph.indexPreview.initialZoom` config option
(quartz.config.yaml, currently `0.35`) that sets the starting zoom level
specifically for that preview box, independent of the full-screen overlay's
zoom. Applies only to the index-page preview; other graph views are
unaffected.

**Path-based node coloring** — Added a `graph.nodeColors` config option
(a list of `{path, color}` rules, e.g. `topics/Concept` → a given color) that
lets graph nodes be colored by which content folder they belong to, instead
of only the default visited/unvisited coloring. Applies consistently across
the local graph, the full-screen global graph, and the index preview — no
per-view configuration needed. When a node's path matches more than one
rule, the most specific (longest) path wins. The current page you're
viewing always keeps its usual highlight color regardless of matching
rules, but for every other node a path match now takes priority over the
default "already visited" tint. Path matching is case-insensitive.
