# Releasing

How a version is made, from the version bump to a published release.

<!-- wf:local intro -->

## Branches

- `main` stays releasable. Work lands on it through pull requests, as in [branches.md](branches.md).
- A release is a tag on `main`: `vX.Y.Z`, or `vX.Y.Z-rc.N` for a pre-release.
- A `release/X.Y` branch is cut from a tag only when a fix must ship while `main` has moved on. The fix reaches both through pull requests.
- When collaborators join, release tags are limited to maintainers.

## Make a release

Run `/release`. The workflow kit's `release` skill walks the steps, through `npx wf release` and `release` in `.workflow/config.json`, and stops for the owner's yes before each push, tag, and workflow run. Only the owner starts it.

<!-- wf:local steps -->

## What a release waits on

<!-- wf:local waits -->

## Versions

`npx wf release next` lists the versions that may follow the newest tag.

- **A pre-release line** starts at `X.Y.Z-rc.1` and counts up. The bump level is chosen when a line starts: below 1.0, minor for new features or anything that breaks, and patch for fixes only.
- **A stable version** only promotes its own line. `0.2.0` needs a published `v0.2.0-rc.N`, and since that tag nothing a build reads may change but the version. Docs, agent files, root Markdown files, and the changelog may change. Anything else needs another pre-release first.

## Release notes

The notes are written for users, in the template at the top of `{{release.changelog}}`. The project's release check fails notes that break it.

- **Order.** A summary of a sentence or two, then `### Before you update`, `### New`, `### Changed`, `### Fixed`, and `### Known issues`.
- **Headings.** One with no entries is left out. At least one entry goes under New, Changed, or Fixed.
- **Entries.** One may start with its area, such as `**Settings:**`. Internal IDs and chunk names stay out.

The `release` skill drafts them. It reads the commits since the last stable tag, looks up the stories they name, keeps only what users see, and shows the owner the draft before it writes it under `## Unreleased`. Each pre-release redrafts the same section, so the stable version's notes cover its whole line.

<!-- wf:local more -->
