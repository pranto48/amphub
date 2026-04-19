# Reproducible Build Environment

The CI and local reproducible build flow is pinned to the following toolchain:

- Node.js: `v22.21.1` (see `.nvmrc`)
- npm: `11.4.2`
- Lockfile: `package-lock.json` (use `npm ci` for deterministic installs)

## Required commands

Run the same sequence used in CI:

1. `npm ci`
2. `npm run lint`
3. `npm run typecheck`
4. `npm run routes:check`
5. `npm run build`

## Notes

- `routes:check` runs generation through `build:dev` and fails if `src/routeTree.gen.ts` changes.
- To refresh the generated route tree manually, run `npm run routes:generate` and commit the updated file.
- For local pre-commit enforcement, set hooks path once:

  ```bash
  git config core.hooksPath .githooks
  ```
