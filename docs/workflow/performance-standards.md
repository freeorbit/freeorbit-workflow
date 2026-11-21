# Performance standards

The rules the `code-reviewer` agent's performance pass checks, and that people and agents follow when they write code on a hot path. Each rule has an ID that a finding cites. The severity table, CS-LIST, and CS-STATE are in [code-standards.md](code-standards.md), and this file grows the same way: by an accepted `STD-` finding or an owner decision.

The hot-paths doc, from `review.hotPaths` in the config, says which paths are hot, how large their data gets, and the budget each must keep. These rules say what must hold on them (added 2026-11-17). The performance pass checks CS-LIST too.

- **A finding names its scale**: the data size or the budget it breaks, from that doc or a measurement. "Could be faster" is not a finding.
- **Off a hot path**, only a cost that grows with the data is raised.
- **Blocking the UI thread or an async runtime** is High wherever it is.
- **A rule is general.** It names what to look for in code, in any stack. A number, such as a pool size or a timeout, belongs in the hot-paths doc as a budget, not here.

## Work and data

- **PERF-LOOP.** No I/O, query, IPC call, or process start inside a loop over data, one per item where one call could serve them all. Calls that do not depend on each other run together, not one after another.
  - A prepared statement or a compiled regex is made once and reused across the loop. File writes are buffered, and a sync to disk runs once per batch, not once per record (added 2026-11-18).
- **PERF-BOUND.** Every read, list, query, queue, and cache has a limit, or pages. Nothing loads a whole dataset into memory when it can stream it, and nothing waits on the network or a process without a timeout.
  - Deep paging continues from the last key seen (`WHERE id > ?`), not from a large `OFFSET`.
  - A cache or a long-lived map keyed by user, session, or request has a size limit or an expiry, and a write clears what it makes stale.
  - A timeout or a cancel reaches the work below it, such as an abort signal or a deadline passed on, so work nobody waits for stops. A request body or an upload has a size limit (added 2026-11-18).
- **PERF-BLOCK.** Nothing blocks the UI thread or an async runtime: no file, disk, or CPU-heavy work in an async handler or an event loop without moving it to a worker or a blocking pool, and no synchronous wait in a render.
  - That includes parsing or writing a large JSON value, hashing or encryption of large data, and a regex with nested or overlapping repeats, such as `(a+)+`, run on outside text (added 2026-11-18).
- **PERF-IPC.** What crosses a process or network boundary is sized to what the other side shows: no whole record where a page of it is read, no polling where an event would do, and no call per item where one carries the list.
  - A query on a hot path names the columns it uses, not `SELECT *`. Large binary data crosses as bytes or a file path, not as base64 or JSON (added 2026-11-18).
- **PERF-ALLOC.** A guideline, not a hard rule. On a path the hot-paths doc lists, no copy, clone, or allocation per item that a borrow, a reuse, or one allocation up front would avoid. Raised nowhere else.
  - No log line per item at info level or above, and no message built when its level is off (added 2026-11-18).
- **PERF-FLOW.** Work fanned out over a list has a limit on how much runs at once, and a producer slows down when its consumer falls behind (added 2026-11-18).
  - Look for a promise per item awaited all together, a task spawned per item, or an unbounded channel, over a list whose size the code does not cap.
  - Look for a stream write whose "full" signal is ignored, and a queue with no limit on its consumers or nowhere for failed items to go.

## Databases

- **PERF-INDEX.** Every column a hot query filters, joins, or sorts on has an index the query can use, and so does each foreign key's referencing column, which a delete of its parent searches (added 2026-11-18, foreign keys 2026-11-21).
  - Look for a `WHERE`, `JOIN`, or `ORDER BY` column with no index in the schema or the migrations, and a composite index whose leading column the query does not use.
  - An indexed column wrapped in a function or a cast, such as `lower(email)`, needs an index on that expression. A `LIKE` that starts with `%`, and an `OR` across different columns, cannot use a plain index.
- **PERF-HOLD.** A transaction or a lock is held only as long as its writes need (added 2026-11-18).
  - Many writes go in one transaction, not one each. Nothing slow happens while a transaction or a lock is open: no network call, no wait on the user, and no file work.
  - A row lock covers only the rows that change. CS-STATE's rule on a lock held across slow work covers in-memory locks.
- **PERF-CONN.** A database connection or an HTTP client is made once and reused, from a pool or a long-lived client, never per request (added 2026-11-18).
  - SQLite runs in write-ahead log mode with a busy timeout, and its writes go through one writer.
- **PERF-MIGRATE.** A schema change on a table that is large or in use neither copies the whole table nor locks it for long (added 2026-11-18).
  - Look for an index built without the engine's online form (`CONCURRENTLY` in Postgres), a column type changed in place, and a default that must be written to every row.
  - Look for a backfill done as one statement instead of in batches, and, in an app that migrates at launch, a table rebuild on the first screen's path.

## Calls to other services

- **PERF-RETRY.** A retry has a cap on attempts, waits longer each time with random spread, retries only errors that a retry can fix, and only repeats work that is safe to repeat (added 2026-11-18).
  - Look for a retry loop with no cap or a fixed wait, a retry on a client error such as a 4xx, a retried payment or create with no idempotency key, and retries stacked at more than one layer.

## Screens

- **PERF-RENDER.** A guideline, not a hard rule. A change to one item does not redraw the whole list, a long list draws only what is in view, and a value worked out from props or state is not worked out again on every render.
  - A value passed to a memoized child or a context keeps its identity between renders: no new object or function each time (added 2026-11-18).
- **PERF-START.** Startup does only what the first screen needs. The rest waits until it is asked for, or runs after the first screen shows.
  - Routes and heavy features load when they are opened. A script in the page's head is deferred. Migrations, indexing, and sync that the first screen does not need start after it shows (added 2026-11-18).
- **PERF-LAYOUT.** Layout is never read and written in turn inside a loop, an animation moves only `transform` and `opacity`, and content that loads late has its space kept (added 2026-11-18).
  - Look for `offsetHeight`, `getBoundingClientRect`, or `scrollTop` read in the same loop that sets a style, and a transition on `top`, `left`, `width`, `height`, or `margin`.
  - Look for an image, a video, or an embed with no width and height or aspect ratio, and content put in above what is already shown.
- **PERF-INPUT.** An event that fires many times a second does its work at most once per frame or after the input pauses, and long work on the main thread gives way so input stays quick (added 2026-11-18).
  - Look for a scroll, resize, pointer-move, or typing handler that does work or calls out on every event, and a scroll or touch listener not marked passive.
  - Look for search as you type with no pause, and a long loop or parse in a click handler that never yields to the browser or moves to a worker.
- **PERF-MEDIA.** A guideline, not a hard rule. An image is sent at the size it shows, in a modern format, and loads when it nears the view; the largest image on the first screen loads first, not lazily, and fonts never hide text while they load (added 2026-11-18).
- **PERF-LIFECYCLE.** What a screen, a component, or a task starts, it stops when it ends: listeners, timers, subscriptions, observers, sockets, and requests in flight. Background work pauses while the app is hidden or idle (added 2026-11-18).
  - Look for an effect with no cleanup, a listen call whose unlisten is never called, and a request with no abort when its screen closes.
  - Look for a timer or poll still running while the window is hidden or minimized, and a loop that spins while it waits.

## Shipping

- **PERF-DEP.** A new dependency that ships to the user is worth its size: the reviewer names what it adds to the bundle or the binary when a scan measures it, and a lighter way the code could do the same.

## This project's

<!-- wf:local performance -->

## Sources

The rules added on 2026-11-18 come from these; each link was checked that day.

- Databases: [Use The Index, Luke](https://use-the-index-luke.com/) and its [page on OFFSET](https://use-the-index-luke.com/no-offset), [SQLite's query planner](https://www.sqlite.org/queryplanner.html), [write-ahead log](https://www.sqlite.org/wal.html), and [busy timeout](https://www.sqlite.org/c3ref/busy_timeout.html), and Postgres on [loading data](https://www.postgresql.org/docs/current/populate.html), [CREATE INDEX](https://www.postgresql.org/docs/current/sql-createindex.html), and [ALTER TABLE](https://www.postgresql.org/docs/current/sql-altertable.html).
- Services: the AWS Builders' Library on [timeouts, retries, and backoff with jitter](https://aws.amazon.com/builders-library/timeouts-retries-and-backoff-with-jitter/) and [safe retries](https://aws.amazon.com/builders-library/making-retries-safe-with-idempotent-apis/), Google's SRE book on [cascading failures](https://sre.google/sre-book/addressing-cascading-failures/), Node.js on [backpressure](https://nodejs.org/en/learn/modules/backpressuring-in-streams) and [not blocking the event loop](https://nodejs.org/en/learn/asynchronous-work/dont-block-the-event-loop), Tokio on [shared state](https://tokio.rs/tokio/tutorial/shared-state), and OWASP on [unrestricted resource use](https://owasp.org/API-Security/editions/2023/en/0xa4-unrestricted-resource-consumption/) and [regex denial of service](https://owasp.org/www-community/attacks/Regular_expression_Denial_of_Service_-_ReDoS).
- Screens: web.dev on [layout thrashing](https://web.dev/articles/avoid-large-complex-layouts-and-layout-thrashing), [animations](https://web.dev/articles/animations-guide), [layout shift](https://web.dev/articles/optimize-cls), [input delay](https://web.dev/articles/optimize-inp), [long tasks](https://web.dev/articles/optimize-long-tasks), [the largest paint](https://web.dev/articles/optimize-lcp), [lazy images](https://web.dev/articles/browser-level-image-lazy-loading), and [fonts](https://web.dev/articles/font-best-practices); React on [effects](https://react.dev/learn/synchronizing-with-effects), [lazy](https://react.dev/reference/react/lazy), and [memo](https://react.dev/reference/react/memo); and MDN on [page visibility](https://developer.mozilla.org/en-US/docs/Web/API/Page_Visibility_API).
- Code: [the Rust performance book on I/O](https://nnethercote.github.io/perf-book/io.html).

Left out, since a reviewer cannot see them in code: query plans and selectivity, which need real data; tuning numbers such as pool sizes and timeouts, which are budgets; Core Web Vitals thresholds, which are measured in the field; server, CDN, and database settings, which are deployment; and build profiles and runtime flags, which are release settings.
