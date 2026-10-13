# DEM Single-Repository Release Workflow & Versioning

This document explains the unified release workflow and versioning rules for DEM.

---

## 1. Overview

DEM is managed as a single repository while releasing two separate packages:
- `@prestizni-software/client-dem` (lightweight, zero Typegoose dependency)
- `@prestizni-software/server-dem` (server managers and database integration)

---

## 2. Versioning & Compatibility Rules

1. **Independent Tracking**:
   - Versions are tracked in `version.ts`:
     - `DEM_CLIENT_VERSION`
     - `DEM_SERVER_VERSION`
2. **Patch Compatibility**:
   - All patch updates (`x.y.Z`) are fully compatible between client and server.
3. **Incompatible Breaking Changes (Middle Number)**:
   - Any incompatible protocol or API change requires incrementing the minor version (`x.Y.z`).
4. **Handshake Verification**:
   - On connection/startup (`startup<ClassName>`), the client sends `clientVersion`.
   - The server validates compatibility using `verifyDEMVersion(clientVersion, serverVersion)`.
   - If the versions have different minor numbers (e.g. `0.7.x` vs `0.6.x`), the connection is rejected with error code `DEM_ERR_VERSION_MISMATCH`.

---

## 3. Release Steps

The release script (`scripts/release.js`) executes the following operations:

1. **Authentication Verification**:
   - Executes `npm whoami` to verify active login session.
   - Executes `npm login` if authentication is missing.

2. **Pre-Flight Verification**:
   - Compiles TypeScript using `npx tsc --noEmit`.
   - Runs full regression test suite using `npm run test_for_AI`.
   - Fails immediately if any type check or unit test fails.

3. **Version Increment**:
   - Updates target version(s) in `version.ts`.

4. **Distribution Build**:
   - Compiles distribution bundle into `dist/` using `npx tsc`.

5. **Package Manifest Generation**:
   - Generates standalone `package.json` for client in `dist/packages/client`.
   - Generates standalone `package.json` for server in `dist/packages/server`.
   - Isolates client dependencies (no `@typegoose/typegoose`).

6. **Release Commit**:
   - Stages `version.ts` and `dist/`.
   - Creates a dedicated commit containing the version bump.

7. **Git Tagging**:
   - Tags `client-v<version>` and/or `server-v<version>`.

8. **NPM Publication**:
   - Publishes `@prestizni-software/client-dem` and/or `@prestizni-software/server-dem` with public access.

---

## 4. Usage Commands

```bash
# Release both client and server patches
node scripts/release.js both patch -m "Fix database connection state check"

# Release client only
node scripts/release.js client patch -m "Client storage fix"

# Release server only
node scripts/release.js server minor -m "Incompatible server protocol update"

# Dry run mode
node scripts/release.js both patch --dry-run
```
