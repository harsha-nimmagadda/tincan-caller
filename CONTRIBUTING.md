# Contributing

Read [docs/PLAN.md](docs/PLAN.md) first; it is the source of truth for scope, wire formats and rules.

- `pnpm lint && pnpm typecheck && pnpm test && pnpm build` must pass before opening a PR.
- Pure logic goes in `src/core/**` (no DOM/React) with unit tests in `test/unit/**`.
- All user-visible strings go through `t('key')`.
- Use conventional commit messages. Pin exact dependency versions and justify any new dependency in the PR.
