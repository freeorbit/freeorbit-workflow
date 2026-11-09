# Build order

How each area's stories are put in the order they are built, chunk by chunk. The order itself, with its status tables, is in [the build order log](../log/build-order.md), and each area's reasons and map are in its own file beside it.

- **Chunk:** one small piece of the build. A few whole stories, built, tested, reviewed, and committed together. It ends with every check passing, and leaves pieces the next chunks reuse.
- **Area:** one part of the product, from `areas` in `.workflow/config.json`. Its order is made at the end of its Step 3 and refreshed at each chunk start.

<!-- wf:local words -->

## Status

- **Areas.** Each area has a row in the log's Areas table and its own file from its Step 1.
  - A cell starts with one of the words in `buildOrder.stepWords`, then the date, and what it waits on, if anything. `npx wf doc:check` holds each cell to those words.
  - Update the cell when a step starts or finishes, and add a dated line to the History in the area's file.
- **Chunks.** A row sits in one of the groups in `buildOrder.groups`, and `npx wf doc:check` holds it there.
  - A chunk is In progress from its chunk start.
  - It is Waiting when it is built and something about the chunk itself is left to check, named in its detail.
  - It is done when nothing is, and its row moves to [the done list](../log/chunks-done.md) with what it delivered.
  - A check that waits on something outside, such as a real provider, stays in [open-questions.md](../log/open-questions.md), and does not hold a chunk at Waiting.

<!-- wf:local status -->

## How a build order is made

- **Shared before specific.** The pieces several areas use come before the areas that need them.
- **A service is built with its first user.** A shared service arrives with the first story that needs it, not in a chunk of its own.
- **A stand-in comes with its first user.** A story that needs something outside the product, such as a mail server, a model, a sign-in, or another computer, gets a stand-in in the same chunk.
  - The stand-in lives in the test-data tool, and the running product can use it, so a scenario reaches its screens.
  - A stub only unit tests can use is not enough.
- **Fewest outside dependencies first.** A part that needs only local data comes before one that needs the network, an account, or a new library.
- **Whole stories.** A chunk ships whole stories, and leaves pieces the next chunks reuse.
- **A new library is asked about at the start of its chunk**, as the asking rules say. The chunk lists the ones it is likely to need.
- **Test data with the chunk.** Each chunk adds the synthetic data its stories need, and tests and the product use that output. The process is in [test-data-process.md](test-data-process.md).

<!-- wf:local rules -->

## Making or updating an area's order

1. At the end of the area's Step 3, list its stories and what each needs: shared pieces, libraries, the network, and other stories. A shared piece that does not exist yet is a story of the area that owns it, and gets a chunk there.
2. Group whole stories into chunks, and order them by the rules above.
3. Add the rows to the log's Chunks table with the area and the next free numbers, counting those in the done list. Numbers name a chunk and are not always the build sequence. A row that goes ahead of a not-started chunk says so.
4. In the area's file, add a short "Why this order" and a map. A chunk of another area this one needs is a node in its map.
5. Ask the owner once about the order, along with any chunks it adds to other areas.
6. At each [chunk start](four-steps.md#chunk-start), put a new or changed story into a chunk or a new row, and ask in the same set of questions.
7. When Step 1 or Step 2 is reopened for an area past its Step 3, the change that accepts a new story also puts it in a chunk: an existing row, or a new Not started row.
   - Ask about its place in the same set of questions as the story.
   - `npx wf doc:check` flags a story a Build cell names that no chunk row lists.
