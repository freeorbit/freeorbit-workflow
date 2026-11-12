---
name: release
description: >-
  Makes a pre-release or stable release, only when the person who holds the
  project's release role (decisions.release in .workflow/config.json, the
  owner unless the project names another) runs it. Asks which kind, offers the
  next version, runs the release checks, then walks the prepare pull request,
  the tag, and whichever of the build, signing and staging, publishing, and
  the runbook's after-tag steps the project has, stopping for their yes before
  each one. Use only when that person invokes /release.
disable-model-invocation: true
---

# Release

The project's runbook is `release.doc` in `.workflow/config.json` (`npx wf config` prints it). Read it whole before the first step: it names the open questions a release waits on, the keys, the build, what runs where, and what comes after the tag, such as a deploy. The steps' commands are `release.commands`, run as `npx wf release <step>`, and the workflows are `release.workflows`.

## Who releases

The release role is `decisions.release` in the config, `owner` unless the project names another, such as `developer`. `npx wf roles` prints who holds it: the one person in a solo project, else the people in its row of the Role table. Below, **the releaser** is that person. A list, such as `["developer", "owner"]`, means a yes from someone holding each role.

Only the releaser starts this skill. When the person who ran `/release` does not hold the role, say who does and stop. Every push, tag, merge, and workflow run below needs the releaser's own yes in a later message, and a yes to one step is not a yes to the next. When a step fails, stop and report it. Do not retry a workflow or delete a draft without asking.

## 1. Choose the version

Ask the releaser: pre-release or stable. Then run `git fetch --tags` and `npx wf release next`. Without `release.commands.next`, the kit works it out from the tags, with `release.tagPrefix` and `release.preRelease`.

- **Pre-release.** Offer the next pre-release of the open line first. When the releaser wants a new line, suggest patch, minor, or major from the notes under `## Unreleased` in the changelog (`release.changelog`), with a one-line reason, and let them choose.
  - Below 1.0, a minor line is for new features or anything that breaks, and a patch line for fixes only.
  - The level is chosen here, because a stable version only ever promotes its own pre-release.
- **Stable.** The only choice is to promote the open pre-release line. If `next` lists none, say a pre-release comes first and stop.

## 2. Check

Run `npx wf release check <version>`. It prints each fact as OK, WARN, or FAIL.

- **FAIL** stops the release. Show each one with how to fix it, and stop.
  - The one exception is the notes. Their FAILs are expected here, because step 3 drafts them. Say so, and go on.
- **WARN** goes to the releaser, who accepts it or stops.
- **Open questions.** List each item the runbook says a release still waits on. For a pre-release, the releaser accepts each one or stops. For a stable version, each one stops the release until it is resolved.

Then run the project's full check in the background. A failure stops the release.

## 3. Prepare

Ask once, then on the releaser's yes:

1. Start `release/prepare-<version with hyphens>` from `main`, such as `release/prepare-0-2-0-rc-1`.
2. Run `npx wf release set <version>`.
3. Draft the notes, as in [Draft the notes](#draft-the-notes), and write them under `## Unreleased` once the releaser accepts them.
4. Stable only: rename `## Unreleased` to `## <version> (YYYY-MM-DD)` with today's date, and start a new empty `## Unreleased` above it. A pre-release leaves its notes under Unreleased.
5. Commit with the `commit` skill, as `release: prepare <version>`.
6. Run `npx wf release check <version>` again. Every line but the branch must still pass.
7. Propose the pull request with the `pull-request` skill. Its yes covers the push. Merging needs its own yes, from whoever holds `decisions.merge`.

### Draft the notes

The notes cover the whole line since the last stable version. Each pre-release of the line redrafts the same Unreleased section, so the stable version's notes are the line's notes.

1. **Gather.** Find the last stable tag with `git tag --list '<tagPrefix>*' --sort=-v:refname`, the first without `release.preRelease` in it. Read `git log --format='%s%n%b' <that tag>..HEAD`, or the whole log when there is none. Keep the text under `## Unreleased` too.
2. **Find what users see.** Each commit body names IDs. Look up each story ID, by the prefixes in `areas`, with `npx wf doc:find <ID>`, and write from what the story says the user can do.
   - Leave out work the user never sees: test data, docs, workflow, agent configuration, review findings with no visible effect, and the release tooling.
   - A finding or E2E entry with a visible effect is a fix. Write what went wrong as the user saw it, from its entry in the review ledger, or its closed file once it is closed.
3. **Sort** each change under the headings of the changelog's template. Start an entry with an area's name when it belongs to one. Data that moves, a setting that resets, or anything that stops working goes under Before you update. An open finding or question users would meet goes under Known issues.
4. **Merge** with what was under Unreleased. Keep the releaser's own wording, and add only what it lacks.
5. **Write** the summary last: a sentence or two on what the release is about.
6. **Show** the draft to the releaser whole, with the commits each entry came from listed below it. Change it as they say. Write it only on their yes. No internal ID goes into the notes.

## Steps the project does not have

Steps 4 to 6 each run a workflow from `release.workflows`. When its entry is `""`, the project has no such workflow: skip what that step would run, and say so in one line, such as "No sign workflow (`release.workflows.sign` is empty), so nothing is signed or staged." Never run `gh workflow run` without a workflow name.

## 4. Tag, and build

After the merge, run `git switch main && git pull --ff-only`, then `npx wf release verify <tagPrefix><version>`. Ask once, then on the releaser's yes:

```bash
git tag <tagPrefix><version>
```

```bash
git push origin <tagPrefix><version>
```

When `release.workflows.build` is set, the push starts it. Find its run with `gh run list --workflow <build> --limit 1`, and watch it in the background with `gh run watch <id> --exit-status`. Report the result and the artifact name. When it is empty, there is no build to watch: report the tag's address and go on.

## 5. Sign and stage

Only when `release.workflows.sign` is set. When the build has passed, ask once, then on the releaser's yes:

```bash
gh workflow run <release.workflows.sign> -f tag=<tagPrefix><version>
```

Watch its run the same way. Report the draft's address from `gh release view <tag> --json url`, and ask the releaser to try each installer.

## 6. Publish

Only when `release.workflows.publish` is set. When the releaser says the installers work, or straight after the build when there is no sign step, ask once, then on their yes:

```bash
gh workflow run <release.workflows.publish> -f tag=<tagPrefix><version>
```

Watch its run. Report the published address, and whether it is a pre-release or the latest release.

## 7. After the tag

When the runbook names a step after the tag, such as "deploy the tag with deploy-dev", offer it with its exact command, such as `gh workflow run deploy-dev -f tag=<tagPrefix><version>`. Run it only on its own yes, from whoever the runbook says runs it, and watch it the same way. When the runbook names none, say the release ends at the tag or the published release.

## After

- Add a line to the release area's history in the build order when the version is the first of its kind, such as the first stable release.
- An issue that took real debugging goes in the troubleshooting log.
