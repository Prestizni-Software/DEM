# Source Restoration Log

## Current State Assessment (2026-06-07)

- **Corrupted Files**: Several core files in the root directory contain merge conflict markers (`<<<<<<< HEAD`).
  - `AutoUpdateClientManagerClass.ts`
  - `AutoUpdatedServerObjectClass.ts`
  - `AutoUpdateServerManagerClass.ts`
- **Missing Files**: `CommonTypes.ts` is missing from the root directory but is referenced by almost every other file.
- **Potential Recovery Sources**:
  - `old_dist/`: Contains `.js`, `.js.map`, and `.d.ts` files. Source maps do NOT contain `sourcesContent`.
  - `../client/` and `../server/`: Contain `.ts` files that appear to be healthy and complete.
    - `CommonTypes.ts` exists in both and seems identical (based on initial inspection).
    - Other core classes like `AutoUpdatedClientObjectClass.ts` also exist there.

## Restoration Strategy

1.  **Verify healthy sources**: Compare files in `../client` and `../server` to ensure they are the most recent "good" versions.
2.  **Scripted Restoration**: Create a script to copy healthy files from neighbor directories or reconstruct them if necessary.
3.  **Verification**: Run existing tests to ensure the restored codebase is functional.

## Investigation Notes

### CommonTypes.ts
- Found in `../client/CommonTypes.ts` and `../server/CommonTypes.ts`.
- Hashes match: `E359C6AF2F16F35F6D54C240BE6C8945714B7C37E5A8...`
- Git history shows it was deleted in the root in recent commits.

### old_dist Contents (Updated)
- Now contains `client-dem/` and `server-dem/` subdirectories.
- These contain `dist/` folders with `.js`, `.js.map`, and `.d.ts` files.
- No original `.ts` (source) files were found in `old_dist` other than declaration files.
- `tsconfig.tsbuildinfo` is present in both subdirectories.

### Neighbor Directories (`../client` and `../server`)
- Contain healthy `.ts` files with no merge conflicts.
- These seem to be the most reliable source for restoration as they represent the last "released" state according to `package.json` scripts.
