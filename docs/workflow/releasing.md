# Releasing

How a version is made, from the version bump to a published release.

<!-- wf:local intro -->

## Branches

- `main` stays releasable. Work lands on it through pull requests, as in [branches.md](branches.md).
- A release is a tag on `main`: `vX.Y.Z`, or `vX.Y.Z-rc.N` for a pre-release.
- A `release/X.Y` branch is cut from a tag only when a fix must ship while `main` has moved on. The fix reaches both through pull requests.
- When collaborators join, release tags are limited to maintainers.

## Make a release

Run `/release`. The workflow kit's `release` skill walks the steps, through `npx wf release` and `release` in `.workflow/config.json`, and stops for the releaser's yes before each push, tag, and workflow run.

- **The releaser** holds the role in `decisions.release`, the owner unless the project names another, such as the developer. `npx wf roles` says who that is. Only the releaser starts the skill.
- **The steps.** Choose the version, check, prepare the version and notes in a pull request, then tag. The project's workflows in `release.workflows` follow: build, on the tag push; sign, which signs the build and stages a draft; and publish.
- **Prepare or not.** `release.prepare` says which kinds go through the prepare pull request: `preRelease` and `stable`, both `true` by default. A kind set to `false` is verified on an up-to-date `main` and tagged from it, with no `set`, no notes, and no change to the version in the project's files.
- **Checks for an unprepared kind.** The project's `check` and `verify` must accept it with no notes, as a WARN, and with the files' version not matching its tag.
- **Steps a project lacks.** A project without one of those workflows, such as a web app with no installers, leaves it `""`. The skill skips that step and says so.
- **After the tag.** The runbook, `release.doc`, names what comes next, such as "deploy the tag with deploy-dev". The skill offers it, and runs it on its own yes.

<!-- wf:local steps -->

## What a release waits on

<!-- wf:local waits -->

## Versions

`npx wf release next` lists the versions that may follow the newest tag.

- **The kit's own.** A project with no `release.commands.next` gets one that reads the tags by `release.tagPrefix` and `release.preRelease`. It lists the next pre-release and the stable version of each open line, then a new patch, minor, and major line from the newest tag.
- **An open line** has a pre-release newer than the last stable version, and no stable version of its own.
- **A pre-release line** starts at `X.Y.Z-rc.1` and counts up. The bump level is chosen when a line starts: below 1.0, minor for new features or anything that breaks, and patch for fixes only.
- **A stable version** only promotes its own line. `0.2.0` needs a released `v0.2.0-rc.N`, and since that tag nothing a build reads may change but the version. Docs, agent files, root Markdown files, and the changelog may change. Anything else needs another pre-release first.

## Release notes

The notes are written for users, in the template at the top of `{{release.changelog}}`. The project's release check fails notes that break it.

- **Order.** A summary of a sentence or two, then `### Before you update`, `### New`, `### Changed`, `### Fixed`, and `### Known issues`.
- **Headings.** One with no entries is left out. At least one entry goes under New, Changed, or Fixed.
- **Entries.** One may start with its area, such as `**Settings:**`. Internal IDs and chunk names stay out.

The `release` skill drafts them. It reads the commits since the last stable tag, looks up the stories they name, keeps only what users see, and shows the releaser the draft before it writes it under `## Unreleased`. Each prepared pre-release redrafts the same section, so the stable version's notes cover its whole line.

<!-- wf:local more -->
