---
name: release
description: >-
  Makes a pre-release or stable release, only when the owner runs it. Asks
  which kind, offers the next version, runs the release checks, then walks the
  prepare pull request, the tag and the build, signing and staging, and
  publishing, stopping for the owner's yes before each one. Use only when the
  owner invokes /release.
disable-model-invocation: true
---

# Release

The project's runbook is `release.doc` in `.workflow/config.json` (`npx wf config` prints it). Read it whole before the first step: it names the open questions a release waits on, the keys, the build, and what runs where. The steps' commands are `release.commands`, run as `npx wf release <step>`, and the workflows are `release.workflows`.

Only the owner starts this skill. Every push, tag, merge, and workflow run below needs its own yes in a later message, and a yes to one step is not a yes to the next. When a step fails, stop and report it. Do not retry a workflow or delete a draft without asking.

## 1. Choose the version

Ask the owner: pre-release or stable. Then run `npx wf release next`.

- **Pre-release.** Offer the next pre-release of the open line first. When the owner wants a new line, suggest patch, minor, or major from the notes under `## Unreleased` in the changelog (`release.changelog`), with a one-line reason, and let them choose.
  - Below 1.0, a minor line is for new features or anything that breaks, and a patch line for fixes only.
  - The level is chosen here, because a stable version only ever promotes its own pre-release.
- **Stable.** The only choice is to promote the open pre-release line. If `next` lists none, say a pre-release comes first and stop.

## 2. Check

Run `npx wf release check <version>`. It prints each fact as OK, WARN, or FAIL.

- **FAIL** stops the release. Show each one with how to fix it, and stop.
  - The one exception is the notes. Their FAILs are expected here, because step 3 drafts them. Say so, and go on.
- **WARN** goes to the owner, who accepts it or stops.
- **Open questions.** List each item the runbook says a release still waits on. For a pre-release, the owner accepts each one or stops. For a stable version, each one stops the release until it is resolved.

Then run the project's full check in the background. A failure stops the release.

## 3. Prepare

Ask once, then on the owner's yes:

1. Start `release/prepare-<version with hyphens>` from `main`, such as `release/prepare-0-2-0-rc-1`.
2. Run `npx wf release set <version>`.
3. Draft the notes, as in [Draft the notes](#draft-the-notes), and write them under `## Unreleased` once the owner accepts them.
4. Stable only: rename `## Unreleased` to `## <version> (YYYY-MM-DD)` with today's date, and start a new empty `## Unreleased` above it. A pre-release leaves its notes under Unreleased.
5. Commit with the `commit` skill, as `release: prepare <version>`.
6. Run `npx wf release check <version>` again. Every line but the branch must still pass.
7. Propose the pull request with the `pull-request` skill. Its yes covers the push. Merging needs its own yes.

### Draft the notes

The notes cover the whole line since the last stable version. Each pre-release of the line redrafts the same Unreleased section, so the stable version's notes are the line's notes.

1. **Gather.** Find the last stable tag with `git tag --list '<tagPrefix>*' --sort=-v:refname`, the first without `release.preRelease` in it. Read `git log --format='%s%n%b' <that tag>..HEAD`, or the whole log when there is none. Keep the text under `## Unreleased` too.
2. **Find what users see.** Each commit body names IDs. Look up each story ID, by the prefixes in `areas`, with `npx wf doc:find <ID>`, and write from what the story says the user can do.
   - Leave out work the user never sees: test data, docs, workflow, agent configuration, review findings with no visible effect, and the release tooling.
   - A finding or E2E entry with a visible effect is a fix. Write what went wrong as the user saw it, from its entry in the review ledger, or its closed file once it is closed.
3. **Sort** each change under the headings of the changelog's template. Start an entry with an area's name when it belongs to one. Data that moves, a setting that resets, or anything that stops working goes under Before you update. An open finding or question users would meet goes under Known issues.
4. **Merge** with what was under Unreleased. Keep the owner's own wording, and add only what it lacks.
5. **Write** the summary last: a sentence or two on what the release is about.
6. **Show** the draft to the owner whole, with the commits each entry came from listed below it. Change it as they say. Write it only on their yes. No internal ID goes into the notes.

## 4. Tag, and build

After the merge, run `git switch main && git pull --ff-only`, then `npx wf release verify <tagPrefix><version>`. Ask once, then on the owner's yes:

```bash
git tag <tagPrefix><version>
```

```bash
git push origin <tagPrefix><version>
```

The push starts the build workflow (`release.workflows.build`). Find its run with `gh run list --workflow <build> --limit 1`, and watch it in the background with `gh run watch <id> --exit-status`. Report the result and the artifact name.

## 5. Sign and stage

When the build has passed, ask once, then on the owner's yes:

```bash
gh workflow run <release.workflows.sign> -f tag=<tagPrefix><version>
```

Watch its run the same way. Report the draft's address from `gh release view <tag> --json url`, and ask the owner to try each installer.

## 6. Publish

When the owner says the installers work, ask once, then on their yes:

```bash
gh workflow run <release.workflows.publish> -f tag=<tagPrefix><version>
```

Watch its run. Report the published address, and whether it is a pre-release or the latest release.

## After

- Add a line to the release area's history in the build order when the version is the first of its kind, such as the first stable release.
- An issue that took real debugging goes in the troubleshooting log.
