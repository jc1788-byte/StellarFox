# Setting Up Code Style Enforcement

This guide will help you set up code style and formatting enforcement for local development.

## Quick Start

### 1. Install Dependencies

```bash
# Install root dependencies for Husky and lint-staged
npm install

# Or if using npm workspaces
npm install --workspaces
```

### 2. Initialize Husky

```bash
# Set up Git pre-commit hooks
npx husky install
```

If you see "husky installed", you're good to go!

### 3. Verify Setup

```bash
# Check that pre-commit hook is executable
ls -la .husky/pre-commit

# Should output something like:
# -rwxr-xr-x  1 user  group  81 Jan 1 12:00 .husky/pre-commit
```

### 4. Test the Hook

Make a small change to a file:

```bash
# Example: add a trailing space or format issue
echo "test = { a : 1 }" > backend/test-file.ts

# Try to commit (this will fail, which is correct)
git add .
git commit -m "test: verify pre-commit hook"

# The hook should:
# 1. Lint and fix the file
# 2. Format the file
# 3. Fail because changes were made but not staged
# This is expected!

# Stage the fixed changes and commit
git add .
git commit -m "test: verify pre-commit hook"

# Clean up
rm backend/test-file.ts
git restore --staged .
```

## What Happens on Commit

When you run `git commit`, Husky automatically:

1. **Runs lint-staged** on your staged files
2. **Fixes linting issues** in backend files
3. **Fixes formatting** with Prettier
4. **Stages any fixes** (if configured)
5. **Allows the commit** to proceed

If the linter or formatter makes changes:
- Those changes won't be automatically staged by default
- You'll need to run `git add .` and `git commit` again
- Or configure lint-staged to auto-stage

## Manual Checks Before Committing

You can manually check your code before committing:

```bash
# Frontend
cd frontend
npm run lint:fix        # Fix linting issues
npm run format:check    # Check formatting
npm run lint           # Re-verify after fixes

# Backend
cd backend
npm run lint:fix       # Fix linting issues
npm run format:check   # Check formatting
npm run lint          # Re-verify after fixes
```

## IDE Setup (Recommended)

### VS Code

1. Install extensions:
   - ESLint: `dbaeumer.vscode-eslint`
   - Prettier: `esbenp.prettier-vscode`

2. Create or update `.vscode/settings.json`:

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
  "eslint.format.enable": true,
  "eslint.lintOnSave": true
}
```

3. **Benefits**:
   - Format on save automatically
   - Linting errors highlighted in editor
   - Problems tab shows all issues
   - Quick fixes available on hover

### JetBrains IDEs (IntelliJ, WebStorm, etc.)

1. Install ESLint plugin (usually comes pre-installed)

2. Configure ESLint:
   - Settings → Languages & Frameworks → JavaScript → Code Quality Tools → ESLint
   - Enable ESLint
   - Choose "Automatic ESLint configuration"

3. Configure Prettier:
   - Settings → Languages & Frameworks → JavaScript → Prettier
   - Enable Prettier
   - Choose "On 'Reformat Code' action"

4. Set format shortcut:
   - Settings → Keymap → Search for "Reformat Code"
   - Assign your preferred shortcut (e.g., Cmd+Shift+L)

## Troubleshooting

### Issue: Pre-commit hook doesn't run

**Solution**:
```bash
# Reinstall Husky
npx husky install

# Verify hook is executable
chmod +x .husky/pre-commit

# Test
git commit --allow-empty -m "test"
```

### Issue: ESLint/Prettier not found

**Solution**:
```bash
# Reinstall dependencies
rm -rf node_modules frontend/node_modules backend/node_modules
npm install

# Clear npm cache if needed
npm cache clean --force
npm install
```

### Issue: Different formatting in IDE vs CLI

**Solution**:
1. Ensure both frontend and backend directories have `.prettierrc` files
2. Verify IDE is using the project's local Prettier, not a global one
3. Restart IDE after installing dependencies

### Issue: Pre-commit hook modifies files but doesn't auto-stage

**This is by design!** The hook will:
1. Fix issues
2. Show you what was changed
3. Require you to stage and commit again

This prevents surprises in what gets committed.

To auto-stage changes, update `.lintstagedrc.json`:
```json
{
  "backend/**/*.ts": [
    "cd backend && npm run lint:fix",
    "cd backend && npm run format",
    "git add"
  ],
  "frontend/**/*.{ts,tsx}": [
    "cd frontend && npm run lint:fix",
    "cd frontend && npm run format",
    "git add"
  ]
}
```

## CI/CD Checks

Every pull request runs:
1. **Frontend CI**: ESLint + Prettier format check
2. **Backend CI**: ESLint + Prettier format check
3. **Code Quality Workflow**: Comprehensive format and consistency checks

If CI fails:
```bash
# Frontend
cd frontend && npm run lint:fix && npm run format

# Backend
cd backend && npm run lint:fix && npm run format

# Commit and push
git add .
git commit -m "fix: address code style issues"
git push
```

## Next Steps

- Read [CODE_STYLE.md](./CODE_STYLE.md) for detailed style guidelines
- Configure your editor as described above
- Make your first commit with the pre-commit hook active
- Review the [ESLint](https://eslint.org/docs/) and [Prettier](https://prettier.io/docs/) documentation

## Questions?

Refer to:
- [CODE_STYLE.md](./CODE_STYLE.md) - Comprehensive style guide
- `.eslintrc.json` files - Rule definitions
- `.prettierrc` files - Formatting rules
- GitHub Issues - Ask the team
