# Code Style & Formatting Enforcement System

Welcome to StellarFox! This project uses an automated code style and formatting enforcement system to maintain consistent, professional code quality.

## Quick Start (5 minutes)

### For New Team Members

```bash
# 1. Clone and navigate to project
git clone <repository>
cd StellarFox

# 2. Install dependencies
npm install

# 3. Set up Git hooks
npx husky install

# 4. Verify it works
git commit --allow-empty -m "test: verify setup"  # Should see lint-staged output

# 5. Configure your IDE (Optional but recommended)
# See SETUP_CODE_STYLE.md for VS Code, WebStorm, etc.
```

That's it! You're ready to code. ✨

### What Happens When You Commit

1. **Husky** intercepts your commit
2. **lint-staged** runs on your staged files
3. **ESLint** fixes linting issues automatically
4. **Prettier** formats your code
5. Commit proceeds (you may need to stage changes again if issues were found)

## Documentation Guide

Read these in order based on your needs:

| Document | Purpose | Read If... |
|----------|---------|-----------|
| **FORMATTING_QUICK_REFERENCE.md** | Quick commands & examples | You just want to code |
| **SETUP_CODE_STYLE.md** | Setup & troubleshooting | You're setting up locally or having issues |
| **CODE_STYLE.md** | Detailed style guide | You need to understand the rules |
| **CODE_STYLE_IMPLEMENTATION.md** | Architecture & overview | You want to understand the system |
| **IMPLEMENTATION_CHECKLIST.md** | Verification & rollout | You're managing the project |

## The Three Layers of Enforcement

### 🖥️ Layer 1: Local Development
- **When**: Before each commit
- **Tool**: Husky + lint-staged
- **Action**: Automatically fixes formatting and linting issues
- **Benefit**: Prevents bad code from leaving your machine

### 📦 Layer 2: CI/CD Pipeline  
- **When**: On every push and pull request
- **Tool**: GitHub Actions workflows
- **Action**: Validates code formatting and linting
- **Benefit**: Enforces standards at the repository level

### 🎨 Layer 3: IDE Integration
- **When**: As you type (optional)
- **Tool**: ESLint & Prettier extensions
- **Action**: Real-time feedback and formatting
- **Benefit**: Immediate feedback while coding

## Key Features

✅ **Automated Formatting**
- No more debates about code style
- Consistent formatting across the entire codebase
- One command: `npm run format`

✅ **Pre-commit Hooks**
- Catch issues before committing
- Automatic fixing where possible
- Never accidentally commit bad code

✅ **CI/CD Validation**
- Every PR is validated
- Consistent standards enforced
- Can't merge without passing checks

✅ **IDE Integration**
- Format on save (optional)
- Real-time linting feedback
- Quick fixes available

✅ **Developer Friendly**
- Clear error messages
- Troubleshooting guide
- Comprehensive documentation
- Works across platforms (Windows, Mac, Linux)

## Style Guidelines at a Glance

```typescript
// ✅ CORRECT
const message: string = 'Hello, world!';
const config = {
  apiUrl: 'https://api.example.com',
  timeout: 5000,
};

// ❌ WRONG
const message = "Hello, world!"
const config = {
    apiUrl: "https://api.example.com",
    timeout: 5000
}
```

**Key rules:**
- Single quotes (not double quotes)
- 100 character line width
- 2 spaces for indentation
- Semicolons always required
- Trailing commas where supported
- Unused parameters prefixed with `_`

See CODE_STYLE.md for detailed rules.

## Common Commands

```bash
# Format your code
npm run format

# Check if code is formatted correctly
npm run format:check

# Fix linting issues
npm run lint:fix

# Check linting
npm run lint

# From root (runs for all packages)
npm run format    # Formats frontend + backend
npm run lint:fix  # Fixes issues in frontend + backend
```

## If Your PR Fails Checks

Don't worry! It's easy to fix:

```bash
# 1. Pull the latest code
git pull origin main

# 2. Fix formatting and linting
npm run format && npm run lint:fix

# 3. Commit and push
git add .
git commit -m "fix: address code style issues"
git push
```

## Setting Up Your IDE (Recommended)

### VS Code (Easiest)

1. Install extensions:
   - ESLint by Dirk Baeumer
   - Prettier by Prettier

2. Add to `.vscode/settings.json`:
   ```json
   {
     "editor.formatOnSave": true,
     "editor.defaultFormatter": "esbenp.prettier-vscode"
   }
   ```

Now code is formatted automatically on save!

See SETUP_CODE_STYLE.md for:
- WebStorm / IntelliJ setup
- NeoVim / Vim setup
- Other IDEs

## Troubleshooting

### "Pre-commit hook doesn't run"
```bash
npm install
npx husky install
```

### "Format check fails in CI"
```bash
npm run format
git add .
git commit -m "fix: formatting"
```

### "ESLint errors I don't understand"
- Check `.eslintrc.json` in the package directory
- See CODE_STYLE.md for rule explanations
- Ask in team chat

### "ESLint/Prettier mismatch"
```bash
npm install
cd frontend && npm install
cd backend && npm install
```

See SETUP_CODE_STYLE.md for more troubleshooting.

## Configuration

All configuration is in place and ready to use:

- **Frontend**: 
  - ESLint extends `next/core-web-vitals`
  - Prettier: 100 width, single quotes, 2 spaces
  
- **Backend**: 
  - ESLint extends recommended + TypeScript
  - Prettier: 100 width, single quotes, 2 spaces

To modify rules:
1. Update `.eslintrc.json` or `.prettierrc`
2. Run `npm run format && npm run lint:fix`
3. Create PR for team review

## FAQ

**Q: Why do I have to fix formatting myself?**
A: You don't! Run `npm run format` and it's automatic.

**Q: What if I disagree with a rule?**
A: Great question! Create an issue to discuss with the team.

**Q: Can I skip the pre-commit hook?**
A: You can with `git commit --no-verify`, but don't! CI will catch it.

**Q: Does this slow down my workflow?**
A: No! It's actually faster - less time spent in code review on style.

**Q: What if I use a different IDE?**
A: See SETUP_CODE_STYLE.md for setup instructions for your IDE.

## Next Steps

1. **Right Now**: 
   - Run `npm install && npx husky install`
   - Test with a commit: `git commit --allow-empty -m "test"`

2. **Next**: 
   - Configure your IDE (see SETUP_CODE_STYLE.md)
   - Make your first real commit
   - Watch the magic happen ✨

3. **Later**: 
   - Bookmark CODE_STYLE.md for reference
   - Share SETUP_CODE_STYLE.md with teammates
   - Relax knowing code quality is automatic!

## Need Help?

1. **Setup issues?** → See SETUP_CODE_STYLE.md
2. **Style questions?** → See CODE_STYLE.md
3. **Quick reference?** → See FORMATTING_QUICK_REFERENCE.md
4. **System architecture?** → See CODE_STYLE_IMPLEMENTATION.md
5. **Still stuck?** → Ask in team chat with error message

## Files You Need to Know

- `.prettierignore` - Files Prettier should ignore
- `.husky/pre-commit` - The Git hook that runs before commits
- `.lintstagedrc.json` - Config for what files get linted
- `frontend/.eslintrc.json` - Frontend linting rules
- `backend/.eslintrc.json` - Backend linting rules
- `frontend/.prettierrc` - Frontend formatting rules
- `backend/.prettierrc.json` - Backend formatting rules

## Resources

- [ESLint Docs](https://eslint.org/docs/)
- [Prettier Docs](https://prettier.io/)
- [TypeScript ESLint](https://typescript-eslint.io/)
- [Husky Docs](https://typicode.github.io/husky/)

---

**Last Updated**: January 2025  
**Status**: ✅ Active

Happy coding! 🚀
