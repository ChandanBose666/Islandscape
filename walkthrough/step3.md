## Fix islands with one click

Open the **Problems** tab (`Ctrl+Shift+M`) to see active warnings for your islands.

Click the **💡 lightbulb** on any warning line (or press `Ctrl+.`) to apply a one-click fix:

| Warning | Fix |
|---|---|
| Large island on `client:load` | Convert to `client:idle` |
| No interactive logic detected | Remove directive (render statically) |
| Likely below the fold | Convert to `client:visible` |

**Set a per-route budget** in `.vscode/settings.json` to get a red status bar when you go over:

```json
{
  "astroIslands.budgets": {
    "/product/*": 150,
    "/blog/*": 30
  }
}
```

**Export a report** via the command palette (`Ctrl+Shift+P` → `Astro Islands: Export Report`) to get a Markdown or JSON summary of all islands sorted by size — useful for performance reviews.
