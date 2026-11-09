<!-- wf:template threat-model: drafted at the end of the first area's Step 3, then reviewed by the owner. Its link to code-standards.md assumes the file sits one folder below docs/, such as docs/app/; fix it if not. Delete this line once the draft is reviewed. -->
# Threat model

What the product protects, who could attack it, and where. A security review starts here. The rules that follow from it are the `SEC-` rules in [code-standards.md](../workflow/code-standards.md).

## What we protect

Each thing whose loss or exposure would hurt the user or the project: their data, their credentials, what reveals who they are, and the keys that sign what ships.

| Asset | Where it is | The worst outcome |
| --- | --- | --- |

## Who could attack it

Each party that controls something the product reads or runs, and what they would want from it.

| Who | What they control | What they want |
| --- | --- | --- |

## Where trust changes

Each boundary where data crosses from one level of trust to another, what must hold there, and the rules that hold it. The code reviewer walks every boundary a change touches.

| Boundary | What crosses | What must hold | Rules |
| --- | --- | --- | --- |

## Known gaps

Each risk accepted for now, with why and what would close it. A gap listed here is not a finding unless it has grown.
