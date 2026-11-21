### Postgres

The project's database is Postgres. These hold beside the general data rules (from the kit's templates/data-engines/postgres.md).

- **Table names.** <Singular or plural: pick one.>
- **PG-IDENTITY.** A key is `bigint generated always as identity`, or `uuid` from `uuidv7()`; never `serial` or `bigserial`.
- **PG-TYPES.** An instant is `timestamptz`, text is `text`, and JSON is `jsonb`.
  - Never `timestamp` without a zone, `timetz`, `char(n)`, the `money` type, or `json`, unless the data model says why.
- **PG-CASE.** A guideline, not a hard rule. A value unique regardless of case, such as an email address, is held by `citext`, or a unique index on `lower()`.
- **PG-ENUM.** A guideline, not a hard rule. A native enum is only for a set that never changes, since a value cannot be removed or reordered; any other small set is a check, and one that grows or carries more is a lookup table, as DATA-SET says.
- **PG-PARTIAL.** A guideline, not a hard rule. A rule that holds only for some rows, such as unique among rows not deleted, is a partial unique index.
- **PG-LEGACY.** No `create rule` and no table inheritance: a trigger or declarative partitioning instead. The database's encoding is UTF8.
