# Spec: Customizations on top of Quartz v4

This document describes, from a functional/behavioral point of view, everything this
fork changed relative to stock Quartz v4. It is meant to be used as a checklist while
migrating to Quartz v5: for each item, check whether the v5 equivalent still exposes the
same extension point, and re-implement the behavior if not.

The fork point is upstream commit `7a77f54` ("fix(i18n): Add RTL Detection based on
Config Set Language (#2100)"). Everything after commit `73e08c6` ("First commit") is
project-specific. See `architecture.md` for the exact file list and diffs.

## 1. Content is sourced from an external submodule, not `content/`

- The vault content (Markdown notes) lives in a separate repository,
  `tdurouchoux/dsview_vault`, wired in as a git submodule at path `dsview_vault/`.
- The `content/` folder still exists in this repo but is now an empty placeholder
  (`content/.gitkeep`) — it is **not** what gets built.
- The build command was changed to point Quartz's content directory at the submodule:
  `npx quartz build -d dsview_vault` (the `-d` flag is Quartz's `argv.directory`,
  i.e. the content root), instead of the default `npx quartz build` (which defaults to
  `content/`).
- CI checks out the repo with submodules and runs `git submodule update --remote
  --recursive` before building, so the site always builds against the latest commit of
  the vault repo, not a pinned commit.
- **Migration implication:** confirm Quartz v5's CLI still supports `-d <dir>` (or
  whatever the renamed/replacement flag is) to point at an arbitrary content directory,
  and keep the submodule + `--remote` update step in the new CI workflow.

## 2. Vault has a typed content model reflected in the graph

The vault content is organized into folders with semantic meaning, and the graph
visualization was extended to encode that semantics visually:

- `contents/` (or any path containing a `contents/` segment) — actual "content" items
  (papers, courses, posts, repos, etc.), rendered as **red** graph nodes with a
  matching red stroke.
- `Concept/` — Machine Learning / DS concepts topic pages — **purple** nodes.
- `Dataset/` — dataset topic pages — **dark purple/magenta** nodes.
- `Library/` — library topic pages — **gold** nodes.
- `Model/` — model topic pages — **cyan** nodes.
- `Platform/` — platform topic pages — **blue** nodes.
- `Tool/` — tool topic pages — **teal** nodes.
- Tag nodes (`tags/...`) keep a distinct fill/stroke color (`tagNode`/`tagNodeStroke`)
  separate from all of the above.
- Everything else falls back to the default Quartz `--gray` node color.
- Classification is done purely by inspecting each note's `filePath` prefix
  (`.startsWith("X/")` or `.includes("/X/")`) — there is no explicit frontmatter field
  driving this, so it depends entirely on the vault's folder layout being preserved.
- **Migration implication:** if Quartz v5 changes what `filePath` looks like on
  `QuartzPluginData`, or restructures how the graph script receives per-node file
  metadata, this classification logic needs to be ported carefully. If the vault's
  folder names ever change, this logic silently stops matching (no error, nodes just
  fall back to gray).

## 3. Ten new theme color tokens for graph node types

`quartz.config.ts` theme colors (both `lightMode` and `darkMode`) gained:
`tagNode`, `tagNodeStroke`, `contentNode`, `contentNodeStroke`, `conceptTopicNode`,
`datasetTopicNode`, `libraryTopicNode`, `modelTopicNode`, `platformTopicNode`,
`toolTopicNode`.

These are optional fields on the `ColorScheme` interface (`quartz/util/theme.ts`), each
falling back to an existing base color (`secondary`, `light`, `tertiary`, etc.) via `??`
if unset, and are all exposed as new CSS custom properties (`--tagNode`, `--contentNode`,
etc.) injected into the generated stylesheet, for both light and dark mode blocks.

- **Migration implication:** re-add these fields to v5's theme type/interface and CSS
  variable generation if the theming system changed shape.

## 4. Local/global graph tuned and reconfigured explicitly

`quartz.layout.ts` now passes explicit `localGraph` and `globalGraph` option objects to
`Component.Graph(...)` instead of using defaults:

- Local graph: `depth: 2`, `scale: 1.5`, `repelForce: 0.35`, `centerForce: 0.3`,
  `linkDistance: 30`, `fontSize: 1.5`, `opacityScale: 0.8`, `showTags: false`.
- Global graph: `depth: -1` (unlimited), `scale: 0.9`, `repelForce: 0.3`,
  `centerForce: 0.6`, `linkDistance: 15`, `fontSize: 1.2`, `opacityScale: 1`,
  `showTags: true`.
- The graph panel's CSS height was increased from 250px to 430px so the (denser, now
  content-typed) graph has more room.
- **Migration implication:** just config values — should port as long as `D3Config`
  (the options type) keeps the same shape in v5.

## 5. Graph rendering performance work

Several changes to `graph.inline.ts` exist purely to keep the graph responsive as the
vault (and therefore node/link count) grows:

- Node link-counts are precomputed once into a `Map` instead of each node doing an
  `O(links)` filter scan to find its own degree (`nodeRadius` was O(n·m), now O(1)
  lookup).
- `forceCollide` iterations scale down adaptively with node count (3 iterations under
  200 nodes, 2 under 500, 1 above) to keep the simulation cheap on large graphs.
- Large intermediate build structures (`data`, `nodeMap`, `linkCounts`, `neighbourhood`,
  `links`, `tags`) are explicitly cleared after the render data is built, so they don't
  linger in memory for the lifetime of the page/component.
- PIXI text `resolution` for node labels was reduced from `devicePixelRatio * 4` to
  `devicePixelRatio * 2` (halves label texture memory/generation cost — this is the
  "halving text repr from global graph" commit).
- The `requestAnimationFrame` loop no longer runs unconditionally forever: it stops once
  the D3 force simulation has cooled down (`simulation.alpha() < simulation.alphaMin()`)
  and no tweens are active, and is restarted (`ensureAnimating()`) on zoom/pan or when
  the simulation reheats (`simulation.on("tick", ...)`). Previously the animation loop
  ran at all times regardless of whether anything changed.
- **Migration implication:** these are self-contained perf optimizations inside the
  inline script; if v5 rewrote `graph.inline.ts` from scratch (likely, given how
  invasive this fork's changes are), each optimization needs to be manually re-applied
  or reconsidered against whatever new rendering approach v5 uses.

## 6. Graph node hover preview popover (Alt/Option + hover)

New feature: holding Alt/Option while hovering a graph node shows the same
"popover-hint" preview card used elsewhere in Quartz for link hovers, positioned near
the node under the cursor.

- Reuses existing Quartz utilities (`fetchCanonical`, `normalizeRelativeURLs` from
  `quartz/util/path.ts` and `quartz/components/scripts/util.ts`) rather than
  reimplementing fetch/parsing — no changes were made to those shared utility files.
  This is the same mechanism the built-in popover feature uses for normal content links.
  Requires `enablePopovers: true` (already set) and pages to carry a `.popover-hint`
  element (standard Quartz content structure).
  - Popovers are keyed/cached per-URL DOM id (`graph-popover-<pathname>`) and reused if
    already open elsewhere.
  - Shows after a 300ms hover delay, hides after a 300ms delay on mouse-leave (both
    cancelable), and is removed on graph teardown along with its keydown/keyup
    listeners.
  - Alt-key state is tracked globally per rendered graph instance via
    `document.addEventListener("keydown"/"keyup", ...)`, added on graph render and
    removed on graph teardown (the returned cleanup function).
- **Migration implication:** verify `fetchCanonical`/`normalizeRelativeURLs` still exist
  with the same signature in v5's `util/path.ts` / `components/scripts/util.ts` (they
  back the standard popover feature, so they likely persist, but the popover DOM/CSS
  class contract — `popover`, `popover-inner`, `active-popover`, `popover-hint` — must
  match whatever v5's own popover implementation expects).

## 7. Click vs. drag detection tightened on graph nodes

Previously, releasing a drag within 500ms of starting it was treated as a "click" and
navigated to that node's page — this misfired on small deliberate drags. Now it also
checks the actual pointer displacement: navigation only fires if the release happens
within 300ms **and** the drag distance is under 5px.

- **Migration implication:** simple threshold change, low risk, but note the tightened
  values (300ms/5px vs. 500ms/no distance check) if v5's drag handler differs.

## 8. Graph zoom label scaling fixed

Labels are now explicitly counter-scaled against the current zoom transform
(`label.scale.set(1 / (scale * transform.k))` on every zoom event) so their on-screen
size stays constant while zooming, rather than only being scaled once when a label
becomes "active" (hovered). The "current zoom level" (`currentTransform?.k`) is also now
factored into `renderLabels()`'s default/active scale calculation, which previously
assumed zoom level 1.

## 9. `FolderContent` page lists all descendant notes recursively

Stock Quartz's `FolderContent` component only listed a folder's **direct** children
(files and, optionally, one level of subfolders represented via a synthetic
"most-recent-dates" placeholder object). This fork replaced that with a recursive
`folder.entries()` walk that collects every actual note (`node.data !== null`) anywhere
under the folder, at any depth, instead of one directory level plus synthetic
subfolder stand-ins.

- Net effect: a folder index page now shows/lists *all* notes nested under it
  (recursively), not just the immediate files plus placeholder subfolder rows.
- The removed logic (synthetic per-subfolder data with rolled-up `dates` from children)
  is gone entirely — subfolders are no longer represented as their own row; only real
  notes appear.
- **Migration implication:** this depends on `FileTrieNode`/folder tree exposing an
  `entries()` method returning `[path, node]` pairs. Confirm this API still exists (and
  still means "all descendants", not "direct children only") in v5's file tree
  implementation — this is the highest-risk file-shape dependency in the fork besides
  the graph script.

## 10. Two-panel width split (left vs. right sidebar)

Stock Quartz used a single `$sidePanelWidth` (320px) for both the left and right
columns of the desktop/tablet grid layout. This fork splits it into
`$leftPanelWidth` (320px, unchanged) and `$rightPanelWidth` (500px, wider — to
accommodate the taller/denser graph and its content-type legend), and updates the
desktop grid's `templateColumns` to use both independently. The tablet grid (which only
has one side column) uses `$leftPanelWidth`.

## 11. Footer links repointed

Footer now links to `Source vault` (`github.com/tdurouchoux/dsview_vault`) and
`Dsview github` (`github.com/tdurouchoux/dsview`) instead of the stock Quartz GitHub
repo and Discord invite.

## 12. Analytics disabled

`analytics: { provider: "plausible" }` → `analytics: null`. No analytics provider is
configured.

## 13. Page title / branding

`pageTitle` changed from `"Quartz 4"` to `"Dsview vault"`. `README.md` rewritten to
describe this project instead of upstream Quartz.

## 14. CI/CD replaced end-to-end

All upstream governance/CI files were deleted (multi-OS test matrix CI, preview-build
workflow, preview-deploy workflow, Docker build/push workflow, issue templates,
dependabot config, PR template, FUNDING.yml) and replaced with a single new GitHub
Actions workflow, `deploy-github-page.yml`:

- Triggers: **daily cron** (`0 7 * * *`, runs the site build once a day so the site
  picks up new vault content even without a push) **and** on every push to `main`.
- Steps: checkout with submodules + full history → `git submodule update --remote
  --recursive` (pull latest vault content, not a pinned commit) → Node 22 setup →
  `npm ci` → `npx quartz build -d dsview_vault` → upload/deploy via
  `actions/upload-pages-artifact` + `actions/deploy-pages` (native GitHub Pages
  deployment, not `docker-build-push` or a `gh-pages` branch push).
- No type-checking (`npm run check`), no test step (`npm test`), no multi-OS matrix —
  this is a single-purpose deploy pipeline, not a contributor-facing CI suite.
- **Migration implication:** purely operational; port the same workflow shape
  (submodule pull + `quartz build -d dsview_vault` + Pages deploy) on top of whatever
  v5's build CLI/output looks like. Also carries incidental history: deployment branch
  was changed from a `v4` branch to `main` at one point, and the cron time was tuned
  from a placeholder to `07:00 UTC` — no functional significance beyond "when the daily
  rebuild runs."
