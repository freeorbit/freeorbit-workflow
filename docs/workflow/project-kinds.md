# Project kinds

What a project is decides where its rules come from, and so which test-data layers and steps it needs. The kind is `kind` in `.workflow/config.json`, `app` by default, and an area can set its own: a domain product's sign-in area is an app.

<!-- wf:local intro -->

## The kinds

| Kind | Example | Where the rules come from | What the test data needs |
| --- | --- | --- | --- |
| `app` | A desktop or web app | Stories and flows | Story check, rules by category, and edge cases for high-risk stories |
| `domain-product` | A review against an industry's criteria | A domain expert and source documents, as well as stories | Step 0 source analysis, a domain register its expert owns, packs, and an accuracy set |
| `data-pipeline` | An import or reporting job | Input contracts and outputs | A contract per source, golden files, and property tests |
| `integration` | A sync with another system | The other system's API and its limits | A stand-in for the other system, recorded replies, and failure modes |
| `catalog` | Guides or listings from public sources | Public sources and a reviewer | Source checks, freshness, and review state |

Every kind gets the [test-data process](test-data-process.md). The kit builds only the `app` layers into its commands so far; the others are written here first and built when a project needs them.

## Three jobs for the designer

| Job | Returns | When |
| --- | --- | --- |
| Story check | Gaps and contradictions, as questions for the story's owner | Whenever stories change, cheaply |
| Rules | New or changed rules, by category | At first draft, and with a refresh |
| Edge cases | New fixture rows | At chunk start, for stories tagged `Risk: high` only |

The formats are in [test-data-formats.md](test-data-formats.md).

## Step 0: source analysis

For a `domain-product` area, or any area whose rules come from documents, Step 0 comes before Step 1.

1. **Keep the samples out of the repo.** They are the client's data even when not personal. Only their profiles come in.
2. **Profile by script.** For each file: its type, pages, text or scan, headings, tables and their columns, dates, revision marks, and references to other documents. A script writes the profiles. No model reads whole documents here.
3. **A contract per document type.** Its sections, where the items that matter sit, how they are named, and what varies across the samples.
4. **Candidate rules with evidence.** A model reads only the extracts the profiles pick, and proposes rules, each naming its file, page, and passage. None is a rule until the domain's owner accepts it.
5. **Measure the reading.** The profiles are the ground truth for an accuracy set, run where the samples are stored.

<!-- wf:local step-0 -->

## Registers owned outside the repo

A domain product keeps its registers apart, each pointing at the others by ID:

- **The domain register.** The criteria a review checks against, owned by a domain expert who may never see the repo.
- **Assessment rules.** How the product judges, each with its evidence, accepted by that expert.
- **Test-data rules.** What must always hold in the product itself, owned by the reviewer, in the area's `test-data/`.

A register the expert owns is published to them as a page they can read and answer. Their answers come back as data, each logged as a decision with their name. The repo stays the source.

## Packs

A pack is one slice of the domain, such as an industry and one of its risks. It holds its part of the domain register, its assessment rules, its document contracts, its generator settings, and its accuracy set.

A new slice is a new pack. Stories name "the configured pack" instead of restating its rules, so they do not grow with every slice.

<!-- wf:local packs -->
