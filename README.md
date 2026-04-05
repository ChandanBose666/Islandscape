# Astro Island Visualizer

> Visualize Astro island hydration costs, dependencies, and optimization opportunities — directly in your editor.

![Astro Island Visualizer](assets/Islandscape%20Icon.png)

---

## What it does

Astro's islands architecture is powerful but opaque. As projects grow, it becomes impossible to know at a glance which components ship JavaScript, what each one costs, or when they hydrate.

This extension makes all of that visible — without leaving VSCode.

---

## Features

### 🏝️ Inline CodeLens Annotations

Above every hydrated island, a colour-coded annotation appears automatically:

```astro
🏝️ client:load | ~34.2 KB gzip | React | 2 props        ← red  (eager)
<AddToCart client:load productId={id} price={price} />

🏝️ client:visible | ~18.7 KB gzip | Svelte | 1 prop      ← green (good)
<ReviewList client:visible reviews={reviews} />

🏝️ client:idle | ~45.1 KB gzip | React | 1 prop          ← yellow
<RelatedProducts client:idle categoryId={product.categoryId} />
```

**Colour coding:** 🔴 `client:load` · 🟡 `client:idle` · 🟢 `client:visible` · 🔵 `client:media` · 🟣 `client:only`

---

### 🗺️ Island Map Sidebar

Click the **Astro Islands** icon in the activity bar to open the Island Map panel. It has four tabs:

#### Islands tab
Flat list of every island in the active file — framework badge, directive, gzip size, and any active warnings.

#### Page tab
Virtual page assembly: aggregate stats for the active file including budget tracking.

```
Page View: /product/[id].astro
  AddToCart        client:load    ~34.2 KB  ⚠
  ReviewList       client:visible ~18.7 KB
  RelatedProducts  client:idle    ~45.1 KB
  ─────────────────────────────────────────
  Total: ~98 KB  /  150 KB budget  ✓
```

#### Graph tab
Interactive dependency DAG powered by Cytoscape.js:
- **Rectangles** — Astro pages
- **Rounded rectangles** — island components (colour-coded by framework)
- **Diamonds** — shared nanostores stores
- **Dashed edges** — state-sharing relationships
- Click any node to navigate to its source file

#### Impact tab
- **Hydration waterfall** — shows when each island hydrates relative to page load
- **Global User Impact** — load-time estimates by network/region (4G → 2G)
- **Budget bar** — visual indicator of JS budget utilisation

---

### 💡 Diagnostics & Code Actions

The extension registers warnings in the Problems tab with one-click fixes:

| Condition | Warning | Fix |
|---|---|---|
| `client:load` + island > 50 KB | "Large island hydrating eagerly" | Convert to `client:idle` |
| No state/hooks/events detected | "No interactive logic found" | Remove directive |
| `client:load` + below-fold name (footer, related…) | "Likely below fold" | Convert to `client:visible` |
| Only island of its framework on the page | "Framework entry cost: +X KB runtime" | — (informational) |
| Large inline prop object/array | "Prop adds to HTML payload" | — (informational) |

---

### 🔍 Hover Tooltips

Hover over any island component name to see a detailed breakdown:

```
🏝️ AddToCart — react island
| Directive  | client:load               |
| Size       | ~34.2 KB gzip             |
| Props      | 2                         |
| Source     | AddToCart.tsx             |

> Hydrates immediately on page load.
```

---

### ⚙️ Commands

| Command | Description |
|---|---|
| `Astro Islands: Analyze Current File` | Re-analyse the active `.astro` file |
| `Astro Islands: Analyze Workspace` | Scan all `.astro` files in the workspace |
| `Astro Islands: Jump to Largest Island` | Navigate to the heaviest island in the active file |
| `Astro Islands: Export Report` | Save a JSON or Markdown report sorted by island size |

---

## Installation

1. Open VSCode
2. Go to Extensions (`Ctrl+Shift+X`)
3. Search for **Astro Island Visualizer**
4. Click Install

The extension activates automatically in any workspace that contains an `astro.config.*` file.

---

## Configuration

Add these to your `.vscode/settings.json` (version-controllable, shared across your team):

```json
{
  "astroIslands.eagerSizeThresholdKB": 50,
  "astroIslands.budgets": {
    "/": 100,
    "/checkout": 60,
    "/product/*": 150,
    "/blog/*": 30
  }
}
```

| Setting | Default | Description |
|---|---|---|
| `astroIslands.eagerSizeThresholdKB` | `50` | Islands larger than this (gzip KB) on `client:load` trigger a warning |
| `astroIslands.budgets` | `{}` | Per-route JS budget in KB — status bar turns red when exceeded |

---

## How size estimation works

| File type | Method |
|---|---|
| `.tsx` / `.jsx` / `.ts` / `.js` | esbuild in-memory bundle + `zlib` gzip (accurate) |
| `.svelte` | `svelte/compiler` → esbuild (accurate) |
| `.vue` | `@vue/compiler-sfc` → esbuild (accurate) |

Results are cached by file content hash and invalidated on save.

---

## Privacy & Telemetry

This extension collects **anonymous usage events** (e.g. "extension activated", "workspace analysed") when VSCode's global telemetry setting is enabled. No source code, file paths, component names, or personal data are ever collected. You can disable telemetry globally in VSCode via `telemetry.telemetryLevel`.

---

## Requirements

- VSCode `^1.85.0`
- An Astro project (the extension only activates in workspaces containing `astro.config.*`)

---

## Contributing

Issues and PRs welcome at [github.com/ChandanBose666/Islandscape](https://github.com/ChandanBose666/Islandscape).
