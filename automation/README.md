# CI workflows

These are the GitHub Actions workflows for this repo, shipped as `.example`
files. To enable them, move them into `.github/workflows/` and commit:

```bash
mkdir -p .github/workflows
git mv automation/ci.yml.example .github/workflows/ci.yml
git mv automation/openapi-sync.yml.example .github/workflows/openapi-sync.yml
git commit -m "ci: enable workflows"
git push
```

> Pushing files under `.github/workflows/` requires a token with the `workflow`
> scope (`gh auth refresh -s workflow`, or push over SSH). That's why they ship
> here as `.example` for the initial publish.

- **ci.yml** — install + typecheck + build on push/PR.
- **openapi-sync.yml** — nightly drift gate: re-fetches the live OpenAPI spec and
  fails if `spec/openapi.json` diverges from production, keeping the SDK in sync.
