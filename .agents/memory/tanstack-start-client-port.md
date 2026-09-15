---
name: TanStack Start client port
description: Non-obvious document-shell constraint when moving a TanStack Start app into a client-only Vite artifact.
---

When porting a TanStack Start app into a client-only Vite artifact, keep the document shell in `index.html` and remove the root route's `shellComponent` that renders `<html>` and `<body>`.

**Why:** The Vite entry mounts into the existing `#root` element. Rendering another document tree inside that element produces a browser hydration warning and malformed DOM even though the page may look correct.

**How to apply:** Preserve the route tree and root route component for app content, but let `index.html` own document metadata, font links, favicon, and the html/body elements.