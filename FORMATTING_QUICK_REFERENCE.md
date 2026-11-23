# Code Formatting Quick Reference

## TL;DR

```bash
# Just format everything
npm run format

# Check if code is formatted
npm run format:check

# Fix lint issues
npm run lint:fix

# Check linting
npm run lint
```

## Formatting Preferences

| Setting | Value |
|---------|-------|
| Print Width | 100 characters |
| Tab Width | 2 spaces |
| Quotes | Single quotes `'` |
| Semicolons | Always `;` |
| Trailing Commas | All (frontend), ES5 (backend) |

## Examples

### ✅ Good

```typescript
// Good: Single quotes, semicolons, proper indentation
const message: string = 'Hello, world!';

const config = {
  apiUrl: 'https://api.example.com',
  timeout: 5000,
  retries: 3,
};

function calculateSum(a: number, b: number): number {
  return a + b;
}
```

### ❌ Bad

```typescript
// Bad: Double quotes, no semicolon
const message = "Hello, world!"

// Bad: Wrong indentation
const config = {
    apiUrl: "https://api.example.com",
    timeout: 5000,
    retries: 3
};

// Bad: Unused variable without _
function processData(data) {
  return 42;
}
```

## Most Common Issues

### Issue: Lines too long
**Fix**: Break into multiple lines
```typescript
// ❌ Too long
const result = fetchData().then(d => processData(d)).then(r => saveResult(r)).catch(e => handleError(e));

// ✅ Formatted
const result = fetchData()
  .then((d) => processData(d))
  .then((r) => saveResult(r))
  .catch((e) => handleError(e));
```

### Issue: Unused parameters
**Fix**: Prefix with underscore
```typescript
// ❌ Bad
function handleEvent(event, context) {
  console.log(event);
}

// ✅ Good
function handleEvent(event, _context: unknown) {
  console.log(event);
}
```

### Issue: Inconsistent imports
**Fix**: Let Prettier sort them
```typescript
// ❌ Unsorted
import { z } from 'zod';
import express from 'express';
import { handler } from './utils';

// ✅ Sorted (automatically by Prettier)
import express from 'express';

import { handler } from './utils';
import { z } from 'zod';
```

## Pre-commit Hook

The hook runs automatically on `git commit`:

1. Lints your staged files
2. Fixes issues automatically
3. Formats your code
4. If changes were made, you need to stage them again

**If you need to skip** (not recommended):
```bash
git commit --no-verify
```

## CI/CD Checks

**On every PR**, these run:
- ✅ ESLint validation
- ✅ Prettier format check
- ✅ Type checking
- ✅ Tests

**If PR check fails**:
1. Pull latest changes: `git pull origin main`
2. Fix locally: `npm run format && npm run lint:fix`
3. Commit and push: `git add . && git commit -m "fix: formatting" && git push`

## IDE Integration (VS Code)

**Install**:
- ESLint extension
- Prettier extension

**Add to `.vscode/settings.json`**:
```json
{
  "editor.formatOnSave": true,
  "editor.defaultFormatter": "esbenp.prettier-vscode"
}
```

**Then**: Format on every save automatically!

## Finding Issues Locally

```bash
# Frontend
cd frontend
npm run lint        # See issues
npm run lint:fix    # Auto-fix
npm run format      # Auto-format

# Backend
cd backend
npm run lint        # See issues
npm run lint:fix    # Auto-fix
npm run format      # Auto-format
```

## Config Files

- **Frontend ESLint**: `frontend/.eslintrc.json`
- **Backend ESLint**: `backend/.eslintrc.json`
- **Frontend Prettier**: `frontend/.prettierrc`
- **Backend Prettier**: `backend/.prettierrc.json`
- **Ignore rules**: `.prettierignore`
- **Pre-commit**: `.husky/pre-commit`
- **Staged files**: `.lintstagedrc.json`

## Common Commands

```bash
# Format everything
npm run format

# Format specific directory
cd frontend && npm run format

# Check without fixing
npm run format:check

# Lint and fix
npm run lint:fix

# Auto-fix most issues before committing
cd frontend && npm run lint:fix && npm run format
cd backend && npm run lint:fix && npm run format
```

## Need Help?

- **Setup issues?** → See `SETUP_CODE_STYLE.md`
- **Style questions?** → See `CODE_STYLE.md`
- **CI/CD failing?** → See troubleshooting in `CODE_STYLE.md`

---

**Remember**: Code formatting is automated. Focus on logic and design! 🎯
