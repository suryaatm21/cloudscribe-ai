# Linting and Formatting Workflow

Google's Firebase deployment enforces strict ESLint rules. Use the options below to keep files compliant before deploying.

## Recommended Approach

- Run `npm run lint -- --fix` inside `api-service/functions` to auto-fix most issues.
- Stage and commit only after the command reports `No errors found`.
- If a rule cannot be auto-fixed, ESLint will list the file and line number—update those manually.

## IDE Helpers

- Install the **ESLint** VS Code extension; enable `"editor.codeActionsOnSave": { "source.fixAll.eslint": true }` in local settings to fix on save.
- Add the **Prettier** extension for quick formatting; configure it to defer to ESLint (`"prettier.enable": true`, `"prettier.eslintIntegration": true`).
- Use the command palette → **ESLint: Fix all auto-fixable problems** on the active file when needed.

## Git Hooks (Optional)

Add the following pre-commit hook if you want automatic linting on every commit:

```bash
cd api-service/functions
npm install --save-dev husky lint-staged
npx husky add .husky/pre-commit "cd api-service/functions && npm run lint -- --fix"
```

This blocks commits that still have lint errors, ensuring deployments succeed without rework.
