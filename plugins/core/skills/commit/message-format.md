# Message format

How a commit message or a pull request's title and body are written. A squash merge makes the pull request's title and body the commit on `main`, so both follow this.

## Topics

A topic is one reason. The change and the docs or tests that exist for that reason are one topic. The subject names the main topic, and the body lists every topic, in order of weight.

## Subject

`scope: what changed`, in 72 characters or fewer, with no full stop.

- **Scope.** The part the change touches most, one of `scopes` in `.workflow/config.json`.
- **What changed.** Plain words starting with a verb, such as "add", "check", "fix", or "name". No commit type (`feat`, `fix`, `docs`), and no file names.

## Body

After a blank line, one bullet per topic, wrapped at 72 characters.

- Start a bullet with its ID when it has one: a story (DR-05), a finding (SEC-043), a chunk (CH-19), or a question.
- One line on what changed and why, two at most. The full reasons stay in the docs the IDs point to.
- Name a file only when the topic is that file, such as a research note.
- A one-topic change with nothing to add beyond the subject may have no body. A pull request has no test plan unless someone asked for one.

Good, one topic with a body:

```
release: check build tools after bundling, close CH-19

- SEC-043: rehash the tools after the build; an AppRun or AppImage
  not in build-tools.txt fails it.
- SEC-044: every Windows SDK link must resolve inside its folder.
```

Good, mixed:

```
downlink: name the plugin and write its Step 1

- Stories DR-01 to DR-20 and flows, from the data requests research.
- APP-37 and GM-33: hand services over from Uplink when the user
  approves, so neither plugin reads the other's data.
```

Bad: `docs: update build-order.md, screens.md, and four-steps.md`

Bad: a subject that is the whole reason in two sentences. It is cut off in every list that shows it.
