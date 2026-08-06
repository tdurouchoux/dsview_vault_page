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

**Progressive label rendering (fixes a mobile crash on the global graph)** —
Node labels in every graph view are now created only when they're about to
become visible and discarded again once they're not, instead of every
label being built up front for every node on the page. On the global graph
(2000+ notes), building every label up front was allocating far more GPU
memory than mobile browsers can handle, crashing the tab when opening the
graph on a phone. Also capped how sharp labels render on high-pixel-density
screens, and long note titles are now truncated with `…` in graph labels
(they previously could be wide enough to fail to render at all on some
mobile GPUs). No visible behavior change on desktop beyond slightly less
oversharp label text.

**Fewer, more relevant labels on the global graph** — The full-screen global
graph (and the index-page preview) no longer show a label for every node by
default — only the most-connected ~2% of nodes do (`graph.globalGraph.topLabelFraction`,
currently `0.02`), still fading in with zoom the same way labels always
have. Every other node's label now appears when you hover that node **or
any node directly connected to it**, and disappears again on mouse-out.
This only changes which labels show by default on the full-screen/global
and index-preview graphs; the per-page local graph (shown in the sidebar
and its expanded view) still shows/fades every node's label ambiently as
before. The index-page preview box specifically shows no ambient labels at
all, however busy the graph — hovering is the only way to see a label
there.

**Neighbour labels on hover for the local graph** — Hovering a node in the
local graph (sidebar preview and expanded view) now also reveals the
labels of every node directly connected to it, not just the hovered node's
own label, matching the hover behaviour already used on the full-screen
global graph. Labels disappear again on mouse-out, same as before.

**More forgiving node hover/click targets** — Hovering, clicking, or
dragging a graph node used to require landing the cursor exactly on its
(often tiny) visible circle, especially for low-connectivity nodes. Every
node now has a larger invisible hit area around it, independent of how
small its circle is drawn, making nodes noticeably easier to target across
all graph views.

**Per-slug exclusion from the graph** — Added a `graph.excludeSlugs` config
option (a list of page slugs) that hides specific pages from every graph
view entirely — local, global, and index preview — including any links to
or from them. Needed because the existing `unlisted: true` frontmatter
convention has no effect on Obsidian Bases pages (`.base` files): Bases
pages are synthesized as virtual pages after the normal frontmatter
pipeline runs, so `unlisted-pages` never sees them. Currently used to hide
`contents/content-base.base`. The excluded page itself is still emitted and
reachable by direct URL, same as `unlisted` pages.
