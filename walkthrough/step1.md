## Open an Astro file

Open any `.astro` file in your project. The extension automatically detects hydrated islands — any component with a `client:*` directive — and analyses their bundle size.

You'll see **inline CodeLens annotations** appear above each island:

```astro
🏝️ client:load | ~34.2 KB gzip | React | 2 props
<AddToCart client:load productId={id} price={price} />
```

**Colour guide:**
- 🔴 Red — `client:load` (hydrates immediately)
- 🟡 Yellow — `client:idle` (deferred)
- 🟢 Green — `client:visible` (on scroll)
- 🔵 Blue — `client:media`
- 🟣 Purple — `client:only`

If you don't see annotations, make sure your workspace contains an `astro.config.*` file — that's what activates the extension.
