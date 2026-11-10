# Build order

## Areas

| Area | Stories | Frames | Architecture | Build |
| --- | --- | --- | --- | --- |
| [app](build-order/app.md) | Done 2026-11-01 | Done 2026-11-02 | Done 2026-11-03 | In progress 2026-11-04 |
| [jobs](build-order/jobs.md) | In progress 2026-11-05 | Not started | Not started | Not started |

## Chunks

### In progress

| Chunk | Title | Who | Stories | Area | Waits on | Status |
| --- | --- | --- | --- | --- | --- | --- |
| CH-02-be | Jobs service | developer:backend | APP-04 | app | CH-02-contract | In progress |

### Waiting

None.

### Not started

| Chunk | Title | Who | Stories | Area | Waits on | Status |
| --- | --- | --- | --- | --- | --- | --- |
| CH-02-fe | Jobs screen | developer:frontend | APP-04 | app | CH-02-contract | Not started |
| CH-03 | Sign out | developer | APP-02 | app | | Not started |
