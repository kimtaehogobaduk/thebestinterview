---
name: Locked frontend toolchain
description: A dependency-management constraint for the imported Lovable TanStack Start app.
---

The project should be installed from the committed `bun.lock` with a frozen install. The TanStack Start/Vite packages are tightly coupled: allowing the installed versions to drift within package.json ranges can make the production build fail inside Rolldown even while the development preview still renders.

**Why:** An unfrozen dependency state produced a reproducible build failure after the preview workflow had already worked; restoring the lockfile versions made the build pass without application changes.

**How to apply:** Use `bun install --frozen-lockfile` before verification and preserve the existing Lovable-managed Vite/TanStack configuration.