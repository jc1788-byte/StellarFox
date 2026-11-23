# Code Style & Formatting Guide

This document outlines the code style, formatting standards, and automated enforcement mechanisms for the StellarFox project.

## Overview

We enforce code style and formatting through:
- **ESLint**: Static code analysis and linting rules
- **Prettier**: Opinionated code formatter
- **Husky + lint-staged**: Pre-commit hooks for automatic fixes
- **CI/CD validation**: Format and lint checks on every pull request

## Configuration

### Frontend (Next.js + React)

**ESLint Config** (`.eslintrc.json`):
- Extends `next/core-web-vitals` for Next.js best practices
- Enables TypeScript support via `@typescript-eslint`
- Enforces no unused variables (except args starting with `_`)
- Warns on `any` type usage

**Prettier Config** (`.prettierrc`):
```json
{
  "semi": true,
  "singleQuote": true,
  "trailingComma": "all",
  "printWidth": 100,
  "tabWidth": 2
}
```

### Backend (Express + TypeScript)

**ESLint Config** (`.eslintrc.json`):
- Extends recommended ESLint and TypeScript rules
- Targets Node.js ES2020+ environment
- Enforces no unused variables (except args starting with `_`)

**Prettier Config** (`.prettierrc.json`):
```json
{
  "semi": true,
  "trailingComma": "es5",
  "singleQuote": true,
  "printWidth": 100,
  "tabWidth": 2
}
```

### Shared Rules

- **Print Width**: 100 characters
- **Indentation**: 2 spaces
- **Quotes**: Single quotes (except where semantically necessary)
- **Semicolons**: Always required
- **Trailing Commas**: All (frontend), ES5 (backend)

## Local Development Workflow

### Installation

Install dependencies in both frontend and backend:

```bash
cd frontend && npm install
cd backend && npm install
```

Setup Git hooks:

```bash
npm install husky lint-staged --save-dev -w
npx husky install
```

### Available Commands

**Frontend**:
```bash
npm run lint              # Check for linting issues
npm run lint:fix         # Automatically fix linting issues
npm run format           # Format code with Prettier
npm run format:check     # Check if code is formatted correctly
```

**Backend**:
```bash
npm run lint             # Check for linting issues
npm run lint:fix        # Automatically fix linting issues
npm run format          # Format code with Prettier
npm run format:check    # Check if code is formatted correctly
```

### Before Committing

Pre-commit hooks automatically:
1. Lint and fix staged files
2. Format staged files

If the hooks make changes, stage those changes and commit again.

To manually check before committing:

```bash
# Frontend
cd frontend && npm run lint:fix && npm run format:check

# Backend
cd backend && npm run lint:fix && npm run format:check
```

## CI/CD Pipeline

### Frontend CI (`.github/workflows/frontend-ci.yml`)

On every push and pull request to `frontend/**`:
1. **Lint**: Run Next.js ESLint
2. **Format Check**: Verify code matches Prettier formatting
3. **Type Check**: Run TypeScript type checking
4. **Tests**: Run Jest unit tests
5. **Build**: Build Next.js application

### Backend CI (`.github/workflows/backend-ci.yml`)

On every push and pull request to `backend/**`:
1. **Lint**: Run ESLint on src and tests
2. **Format Check**: Verify code matches Prettier formatting
3. **Build**: Compile TypeScript
4. **Tests**: Run Jest test suite
5. **Integration Tests**: Run integration test suite

### CI Job Failure

If any of these checks fail, the pull request cannot be merged:
- ❌ Linting errors
- ❌ Format violations (run `npm run format` locally)
- ❌ Type errors
- ❌ Test failures

## Handling CI Failures

### Format Check Fails

If `npm run format:check` fails in CI:

```bash
# Navigate to the appropriate directory
cd frontend  # or cd backend

# Automatically fix formatting
npm run format

# Stage and commit
git add .
git commit -m "fix: format code"
```

### Lint Check Fails

If `npm run lint` fails in CI:

```bash
# Navigate to the appropriate directory
cd frontend  # or cd backend

# Automatically fix linting issues where possible
npm run lint:fix

# Review any remaining issues
npm run lint

# Stage and commit
git add .
git commit -m "fix: address linting issues"
```

## Disabling Rules

While not recommended, individual rules can be disabled with inline comments:

```typescript
// ESLint disable
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const data: any = jsonParse(input);

// Prettier disable (use sparingly)
// prettier-ignore
const weirdFormatting =    {  a:  1  };
```

For project-wide rule changes, update the appropriate `.eslintrc.json` or `.prettierrc` file and ensure all team members are aware.

## Editor Configuration

### VS Code

Install recommended extensions:
- **ESLint**: `dbaeumer.vscode-eslint`
- **Prettier**: `esbenp.prettier-vscode`

Create/update `.vscode/settings.json`:
```json
{
  "editor.formatOnSave": true,
  "editor.defaultFormatter": "esbenp.prettier-vscode",
  "[typescript]": {
    "editor.defaultFormatter": "esbenp.prettier-vscode"
  },
  "[typescriptreact]": {
    "editor.defaultFormatter": "esbenp.prettier-vscode"
  },
  "eslint.validate": ["typescript", "typescriptreact"],
  "eslint.format.enable": true
}
```

### Other IDEs

Configure your IDE to:
1. Enable ESLint integration
2. Enable Prettier integration
3. Format on save
4. Use the local ESLint and Prettier configs

## GitHub Integration

### Branch Protection Rules

Recommended branch protection settings for main/develop:
- ✅ Require status checks to pass: Frontend CI, Backend CI
- ✅ Require branches to be up to date before merging
- ✅ Require code reviews before merging

## Continuous Improvement

### Adding New Rules

To add a new ESLint rule:
1. Update `.eslintrc.json` in the affected directory
2. Run `npm run lint:fix` to auto-fix where possible
3. Commit changes with a clear message
4. Create a PR for team review

### Updating Prettier Config

To change Prettier settings:
1. Update `.prettierrc` or `.prettierrc.json`
2. Run `npm run format` in affected directories
3. Commit the formatting changes
4. Create a PR for team review

## Resources

- [ESLint Documentation](https://eslint.org/docs/)
- [TypeScript ESLint Plugin](https://typescript-eslint.io/)
- [Prettier Documentation](https://prettier.io/docs/)
- [Husky Documentation](https://typicode.github.io/husky/)
- [lint-staged Documentation](https://github.com/okonet/lint-staged)

## Questions?

If you have questions about code style or formatting, please:
1. Check this guide
2. Search existing issues/discussions
3. Create a new discussion or issue
