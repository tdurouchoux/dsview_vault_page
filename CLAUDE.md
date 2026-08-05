# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this repo is

This is a fork of [Quartz v5](https://quartz.jzhao.xyz) (static site generator, `upstream` remote = `jackyzha0/quartz`), used to publish the [dsview_vault](https://github.com/tdurouchoux/dsview_vault) Obsidian vault (a personal Data Science knowledge base) as a website. The `v4`/`v5`-style branch naming follows upstream's own branches; the current working branch is `v5_migration`.

Two related repos are relevant to changes here:

- `dsview_vault` (checked out at `./dsview_vault`, a git submodule wired via `.git/modules/dsview_vault` but not currently registered in `.gitmodules`) — the actual vault content, authored in Obsidian.
- `dsview-vault-graph` (sibling checkout at `../dsview-vault-graph`, also available as an additional working directory) — a fork of the upstream `@quartz-community/graph` plugin, customized to better fit dsview's graph ontology (contents ↔ topics, not generic backlinks).

The intent going forward is **minimal, targeted changes**: mostly `quartz.config.yaml` tweaks, plus small patches to this package or to the forked graph plugin — not a general-purpose Quartz customization effort.

Every confirmed change made under `quartz/` (or to the forked graph plugin) that goes beyond `quartz.config.yaml` must be logged in `spec.md` at the repo root: a short functional description of the change and its impact on the rendered page, no implementation detail. Update `spec.md` in the same turn the change is confirmed — don't batch it for later.

The vault content itself lives in `dsview_vault/`, not in the default `content/` directory (which is just an empty `.gitkeep` placeholder). Because of this, every `quartz build`/`quartz plugin` invocation must pass `-d dsview_vault` (`--directory`, the content-source flag — not to be confused with `-o`/`--output`, which defaults to `public/`).

## Commands

```shell
npm install                          # install deps (legacy-peer-deps + engine-strict via .npmrc)
npx quartz plugin install            # install/build external plugins declared in quartz.config.yaml (also runs as `prebuild`)
npm run check                        # tsc --noEmit + prettier --check
npm run format                       # prettier --write
npm test                             # tsx --test (Node's built-in test runner; *.test.ts files next to source)
npx quartz build -d dsview_vault --serve   # local dev server with hot reload (content + config watch)
npx quartz build -d dsview_vault -o public # one-off build, output to ./public
```

To run a single test file: `npx tsx --test quartz/plugins/loader/config-loader.test.ts`.

Plugin management (see `docs/cli/plugin.md` for the full command reference):

```shell
npx quartz plugin add <source>     # e.g. github:user/repo, ./local/path, ../sibling-plugin
npx quartz plugin list
npx quartz plugin install --from-config   # install anything referenced in quartz.config.yaml but missing from quartz.lock.json
npx quartz plugin install --clean         # restore exactly the commits pinned in quartz.lock.json (used in CI)
npx quartz plugin prune                   # remove installed plugins no longer referenced in config
```

There is no repo-specific test/build setup beyond upstream Quartz's — the `.github/workflows/*.yaml` are still gated on `github.repository == 'jackyzha0/quartz'` and have not been adapted to this fork yet, so don't treat them as this repo's live CI.

## Architecture

Full upstream write-up: `docs/advanced/architecture.md` and `docs/advanced/making plugins.md` (read these before writing any plugin code — they're detailed and avoid re-deriving them here).

### Config is data, not code

`quartz.ts` just calls `loadQuartzConfig()` / `loadQuartzLayout()` from `quartz/plugins/loader/config-loader.ts`, which parse `quartz.config.yaml` (falling back to `quartz.config.default.yaml`) into the actual plugin/layout objects Quartz uses at build time. Almost all customization for this fork should happen in `quartz.config.yaml`, not by editing files under `quartz/`. JS-only plugin options (callbacks that can't be expressed in YAML) go in `quartz.ts` via `ExternalPlugin.Foo({...})` calls placed *before* `loadQuartzConfig()`.

### Plugin system (v5-specific — differs a lot from v4/upstream docs elsewhere)

Plugins are standalone repos, not files in this tree. A `source` in `quartz.config.yaml` can be an npm package (`@quartz-community/*`), a `github:` spec, a git URL, or a local path (e.g. `../dsview-vault-graph`, used for the forked graph plugin). Non-npm plugins are cloned/symlinked into `.quartz/plugins/<name>` (gitignored) and re-exported via an auto-generated `.quartz/plugins/index.ts`; their resolved commit/path is recorded in `quartz.lock.json`. Plugins ship prebuilt `dist/` so installs are near-instant unless developing locally.

Four processing categories, in pipeline order: **Transformer** → **Filter** → **Emitter** (with **Page Type** plugins registered into the built-in `PageTypeDispatcher` emitter). A plugin's category is read from its `package.json` `"quartz"` manifest (preferred) or detected by probing its exported factory function (`quartz/plugins/loader/config-loader.ts`: `detectCategoryFromModule`/`findFactory`). Plugins can *also* be "component" plugins (register UI via `componentRegistry`) or "bases view" plugins independent of the four categories above.

Layout placement (header/left/right/beforeBody/afterBody/footer) is driven by each plugin's `layout:` block in `quartz.config.yaml` (`position`, `priority`, optional `group`/`groupOptions` for flex groups, `display: mobile-only|desktop-only`, `condition:`), resolved by `buildLayoutForEntries`/`resolveGroups` in `quartz/plugins/loader/config-loader.ts`. Per-page-type overrides live under `layout.byPageType.<type>` in the YAML (exclude plugins, override `positions`, or set a different frame `template`).

### Page frames

Frames (`quartz/components/frames/`) control the inner HTML structure per page type (`DefaultFrame` = 3-column, `FullWidthFrame`, `MinimalFrame`, or plugin-provided). Resolution order: YAML `layout.byPageType.<name>.template` → plugin-registered frame (`FrameRegistry`) → built-in frame → `"default"`. Relevant when adding a page type that needs a non-standard layout (e.g. a fullscreen graph view).

### Community package layering (external, not in this repo)

Plugins (including the forked graph plugin) depend on `@quartz-community/types` (contracts/no deps) → `@quartz-community/utils` (path/DOM/date/etc. helpers) → `@quartz-community/runtime` (browser-only). Never import from `@jackyzha0/quartz` or `vfile` directly from plugin code — see the "What to Import from Where" table in `docs/advanced/making plugins.md`.

### This fork's config deltas vs. upstream defaults

Diffing `quartz.config.yaml` against `quartz.config.default.yaml` is the fastest way to see current customization: notably `pageTitle`/`baseUrl` set for dsview, `syntax-highlighting` theme changed to `default`, `unlisted-pages`/`footer`/`obsidian-flavored-markdown` (comments/wikilinks/callouts/mermaid) enabled, extra frontmatter fields (`already_read`, `read_priority`, `relevance`, `source`) allow-listed, `obsidian-plugin-excalidraw` added, `graph` sourced from `../dsview-vault-graph` instead of `@quartz-community/graph` with custom `localGraph`/`globalGraph` force/depth options, and `bases: { exclude: [graph] }` to keep the graph plugin out of Bases table views.
