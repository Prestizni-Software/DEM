# DEM Single-Repository Release Workflow

This document explains the unified release workflow for DEM.

---

## 1. Overview

DEM previously synchronized code into external client and server repositories.
All release logic is now consolidated directly within this single repository.

---

## 2. Release Steps

The release script (`scripts/release.js`) executes the following operations:

1. **Authentication Verification**:
   - Executes `npm whoami` to verify active login session.
   - Executes `npm login` if authentication is missing.

2. **Pre-Flight Verification**:
   - Compiles TypeScript using `npx tsc --noEmit`.
   - Runs full regression test suite using `npm run test_for_AI`.
   - Fails immediately if any type check or unit test fails.

3. **Distribution Build**:
   - Compiles distribution bundle into `dist/` using `npx tsc`.

4. **Version Bump**:
   - Updates `version` in `package.json` according to semver (`patch`, `minor`, `major`, or custom version string).

5. **Release Commit**:
   - Stages `package.json`, `package-lock.json`, and `dist/`.
   - Creates a dedicated commit containing only the version bump.
   - Formats the commit title as `Release v<version>: <description>` or `Release v<version>`.

6. **Git Tagging**:
   - Creates an annotated tag `v<version>`.

7. **Origin Synchronization**:
   - Pushes release commit and git tag to `origin/main`.

8. **NPM Publication**:
   - Publishes the package to the npm registry with public access.

---

## 3. Usage Commands

```bash
# Standard patch release with automated message
npm run release

# Patch release with a summary description
node scripts/release.js patch -m "Fix database connection state assertion"

# Minor release with description
node scripts/release.js minor --desc "Add single-repository release workflow"

# Major release
npm run release:major

# Dry run (runs tests and builds dist/ without bumping version or committing)
node scripts/release.js patch --dry-run
```
