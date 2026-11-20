### SQLite

The project's database is SQLite. These hold beside the general data rules (from the kit's templates/data-engines/sqlite.md).

- **Table names.** <Singular or plural: pick one.>
- **SQLITE-FK.** Every connection runs `PRAGMA foreign_keys = ON` before its first query, since SQLite leaves foreign keys off by default on each connection.
- **SQLITE-STRICT.** A guideline, not a hard rule. A new table is `STRICT`, so a column holds only its type.
  - A table that is not strict uses SQLite's own type names, `INTEGER`, `REAL`, `TEXT`, `BLOB`, and a check such as `check (typeof(x) = 'integer')` where the type matters.
- **SQLITE-KEY.** A primary key that is not an `INTEGER PRIMARY KEY` is declared `not null`, since SQLite lets such a key hold null.
  - `AUTOINCREMENT` where an id is held outside its table, as DATA-KEY says, since a plain `INTEGER PRIMARY KEY` may give a deleted row's id again.
  - `WITHOUT ROWID` only for a small table with a composite or text key.
- **SQLITE-TIME.** In place of DATA-TYPE's types, each date and instant column uses one stated form: ISO 8601 text in UTC, such as `2026-11-21T10:00:00Z`, or Unix seconds. A day is `YYYY-MM-DD` text.
- **SQLITE-BOOL.** A flag is `integer not null check (x in (0, 1))`, with a default.
- **SQLITE-QUOTE.** A string is in single quotes, such as `default 'active'`; double quotes name a column, and a missing one silently becomes a string.
