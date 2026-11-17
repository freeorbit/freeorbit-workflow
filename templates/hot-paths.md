<!-- wf:template hot-paths: drafted at the end of the first area's Step 3, beside the threat model, then reviewed by the owner. Its link to code-standards.md assumes the file sits one folder below docs/, such as docs/app/; fix it if not. Delete this line once the draft is reviewed. -->
# Hot paths

Where the product spends its time, how large its data gets, and what each path may cost. A performance review starts here. The rules that follow from it are the `PERF-` rules in [code-standards.md](../workflow/code-standards.md).

## Budgets

What the person waits for, and the most it may take on the computer the product is built for. A budget no one measures yet says so in How it is measured.

| What | Budget | How it is measured |
| --- | --- | --- |

## How large the data gets

Each kind of data that grows with use, how much a typical person has, and the most the product must handle.

| Data | Typical | Largest it must handle |
| --- | --- | --- |

## Hot paths

Each path that runs often, on a lot of data, or while the person waits. Files are globs in code spans, such as `src/sync/**`; a light review runs the performance pass when its changes touch one. The code reviewer walks every path a change touches.

| Path | Files | Runs | Data it touches | Budget | Rules |
| --- | --- | --- | --- | --- | --- |

## Known costs

Each cost accepted for now, with why and what would remove it. A cost listed here is not a finding unless it has grown.
