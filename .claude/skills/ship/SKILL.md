---
name: ship
description: Bump version, build DMG + .app, install locally, tag in git. Run before sharing a build.
---

# /ship

Ship a new local release of Dwarf Claws (Tauri 2 + SolidJS). Bumps version across three files, builds DMG + .app, installs to `/Applications`, commits, and tags. Does NOT push.

Repo root: `/Users/misaelvillaverde/Developer/potifar/dwarf-claws`

## Version files (must stay in sync)

- `src-tauri/tauri.conf.json` — top-level `"version"`
- `src-tauri/Cargo.toml` — `[package] version` (NOT dependency versions)
- `package.json` — top-level `"version"`

Current sanity hint: all three were at `0.1.0` when this skill was authored.

## Preflight (abort if any fail)

1. Read all three version files. If they disagree, STOP and tell the user which differs.
2. Run `cd /Users/misaelvillaverde/Developer/potifar/dwarf-claws && git status --short`. If there are uncommitted changes unrelated to the version bump, STOP and ask the user before continuing — don't bundle unrelated work into the version commit.
3. If any of the three version files are already modified in the working tree, bail early.

## Steps

### 1. Ask bump type

Use `AskUserQuestion` with this exact schema:

```json
{
  "questions": [
    {
      "header": "Bump",
      "question": "Which version bump?",
      "multiSelect": false,
      "options": [
        { "label": "patch", "description": "Bug fixes / tiny tweaks.\nIncrements Z in X.Y.Z.\nExample: 0.1.0 -> 0.1.1.\nUse for safe, non-breaking changes." },
        { "label": "minor", "description": "New features, backward-compatible.\nIncrements Y, resets Z to 0.\nExample: 0.1.0 -> 0.2.0.\nUse when adding capabilities." },
        { "label": "major", "description": "Breaking changes.\nIncrements X, resets Y and Z to 0.\nExample: 0.1.0 -> 1.0.0.\nUse when API/UX breaks compatibility." }
      ]
    }
  ]
}
```

### 2. Compute new version

Parse `X.Y.Z` from `src-tauri/tauri.conf.json`. Apply bump:
- patch: `X.Y.(Z+1)`
- minor: `X.(Y+1).0`
- major: `(X+1).0.0`

### 3. Confirm with user

Single short message: `Bump <old> -> <new>?  Proceed?`. If they object, abort cleanly. If yes, proceed.

### 4. Update the three files

Use `Edit` (not Write):

- `src-tauri/tauri.conf.json`: replace `"version": "<old>"` with `"version": "<new>"`
- `src-tauri/Cargo.toml`: replace `version = "<old>"` with `version = "<new>"` (the one directly under `[package]` — match enough surrounding context to be unique)
- `package.json`: replace `"version": "<old>"` with `"version": "<new>"`

### 5. Build

```
cd /Users/misaelvillaverde/Developer/potifar/dwarf-claws && pnpm tauri build --bundles dmg,app
```

Use Bash with `timeout: 600000` (10 min). If the build fails:
- Show the user the last ~30 lines of output.
- STOP. Do NOT commit, tag, or install. Do NOT revert the version files — leave them so the user can fix and retry.

### 6. Install the .app

```
rm -rf "/Applications/Dwarf Claws.app" && cp -R "/Users/misaelvillaverde/Developer/potifar/dwarf-claws/src-tauri/target/release/bundle/macos/Dwarf Claws.app" /Applications/
```

If this fails due to permissions, surface the raw error — don't swallow it.

### 7. Commit and tag (no push)

Check what was modified:

```
cd /Users/misaelvillaverde/Developer/potifar/dwarf-claws && git status --short
```

Stage only these (and only if modified):
- `src-tauri/tauri.conf.json`
- `src-tauri/Cargo.toml`
- `package.json`
- `src-tauri/Cargo.lock` (only if `git status` shows it modified)
- `pnpm-lock.yaml` (only if `git status` shows it modified)

Then:

```
cd /Users/misaelvillaverde/Developer/potifar/dwarf-claws && git commit -m "chore: bump v<new>"
cd /Users/misaelvillaverde/Developer/potifar/dwarf-claws && git tag "v<new>"
```

Hard rules:
- Commit message is exactly `chore: bump v<new>`. No body. No trailers.
- NEVER add Claude as a commit author. Use default git settings (no `--author`, no `Co-Authored-By`).
- NEVER push. No `git push`. No `git push --tags`.

### 8. Find the DMG

```
ls /Users/misaelvillaverde/Developer/potifar/dwarf-claws/src-tauri/target/release/bundle/dmg/*.dmg | tail -1
```

Expected pattern: `Dwarf Claws_<new>_aarch64.dmg`. Capture the absolute path.

### 9. Final summary (Spanish, terse)

Print to the user:

```
Version: X.Y.Z -> A.B.C
App reinstalada en /Applications/Dwarf Claws.app — Cmd+Q y relanza
Tag v<new> creado local (no push)
DMG: <absolute-path>
```

The final line must be exactly `DMG: <absolute-path>` so the user can copy it.

## Guardrails recap

- Three version files must agree before AND after.
- Don't bundle unrelated changes into the version commit.
- Build failure = stop, no commit/tag/install, leave bumped files in place.
- No push, no Claude author, no extra commit body.
- Surface filesystem permission errors verbatim.
