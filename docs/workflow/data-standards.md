# Data standards

The rules a project's schemas, migrations, and area data models follow, in any database, and that the `code-reviewer` agent's structure pass checks. Each rule has an ID that a finding cites. The severity table is in [code-standards.md](code-standards.md), and this file grows the same way: by an accepted `STD-` finding or an owner decision.

The rules below hold for any database. The conventions of the one a project uses, such as Postgres or SQLite, are in its own part at the end, copied from the kit's `templates/data-engines/` when Step 3 picks the store (added 2026-11-21).

- **The engine's part wins.** An engine rule that names a `DATA-` rule, such as SQLITE-TIME for DATA-TYPE's instants, replaces it for that database.
- **Consistency over taste.** Where good sources differ, such as singular or plural table names, a project picks one in its part and holds to it.
- **Who checks what.** The structure pass checks these. Injection, secrets, access to a record, and personal data stay with the security rules; indexes, transactions, and a migration's cost with the [performance rules](performance-standards.md).
- **A rule or a guideline.** A guideline is raised with a reason to change; a reason the data model states overrides it.

## Names

- **DATA-NAME.** Names are lower snake_case, unquoted, and no reserved word, such as `order`, `user`, or `group`.
  - Tables are all singular or all plural, as the project's part says; no `tbl_` prefix.
  - A name says what it holds: an instant ends in `_at`, a day in `_on`, a flag starts with `is_` or `has_`, and a unit is in the name, such as `_cents` or `_ms`.
  - A column that refers to another table's row is `<table>_id`. Besides those, only an outside system's id, named for it, such as `stripe_customer_id`, a public id, `public_id`, and the engine's own key, such as MongoDB's `_id`, end in `_id`.
- **DATA-CONSTRAINT.** A guideline, not a hard rule. Keys, indexes, and constraints get names in one pattern, such as `fk_<table>_<column>` and `index_<table>_on_<columns>`, not the database's generated ones.

## Keys

- **DATA-KEY.** Every table has a primary key.
  - A key is never worked out from the rows there, such as `max(id) + 1`: it is the database's own, or an app-made UUID v7, or the engine's id type, such as MongoDB's ObjectId.
  - An id held outside its table, such as in a link, another system, or a log, is never given to another row.
  - A natural key that can change, such as an email address, is not the primary key; it gets a unique constraint beside a surrogate key.
  - A join table's key is the pair of ids, or a surrogate with a unique constraint on the pair, so a pair is never there twice.
- **DATA-KEY-TYPE.** A guideline, not a hard rule. A key is a 64-bit identity, or a time-ordered UUID (v7) where ids are made in more than one place. A random UUID (v4) is not the key of a large table, since its new rows land all over the key's index instead of at its end.
- **DATA-EXPOSE.** An id shown outside the product, such as in a link, cannot be guessed by counting: a random public id, `public_id`, beside the key, not a v7 one, which tells when its row was made. Who may read the row is SEC-ACCESS's, in the security rules.

## Types

- **DATA-TYPE.** Each value has the type that holds it exactly.
  - Money is whole minor units or an exact decimal, never a float, with its currency in a column or the name.
  - An instant is UTC, in the engine's type that knows the zone where it has one, else in the form the project's part names.
  - A day with no time is a date, or the day form the project's part names, never an instant.
  - A flag is a boolean, or the engine's stand-in for one, not null, with a default.
  - Text has no arbitrary length, such as `varchar(255)`; a limit that matters is a check on its length.
- **DATA-SET.** A guideline, not a hard rule. A column that holds one of a few values is held to them: a check for a small set, a lookup table for one that grows or carries more, and a native enum only where its engine part allows. Free text for a status says why in the data model.
- **DATA-JSON.** A guideline, not a hard rule. JSON holds only what the database never queries, joins, or checks. A field that is filtered, joined, or held to a rule is a column; an array never holds other rows' ids; no table of attribute names and values.

## Integrity

- **DATA-NULL.** A column is not null unless its absence means something, and the data model says what.
- **DATA-FK.** Each column that refers to another row has a foreign key with an explicit `on delete`: cascade, restrict, or set null, as the data model says. The database holds the link, not only the app; the column's index is PERF-INDEX's.
- **DATA-CHECK.** What must always be true is held by the database: unique values and pairs, ranges, and formats, as constraints, not only as the app's validation.
- **DATA-NORM.** A guideline, not a hard rule. Each fact is stored once: no repeated columns, such as `phone1` and `phone2`, and no list in one column. A copy kept for speed says, in the data model, what keeps it in step.

## Lifecycle

- **DATA-TIME.** A guideline, not a hard rule. A table whose rows change has `created_at` and `updated_at`, not null, and something that sets `updated_at` on each change.
- **DATA-DELETE.** A guideline, not a hard rule. A row is deleted, or moved to an archive table, unless the stories need it back.
  - A soft delete, a `deleted_at` column, says why in the data model; its unique constraints leave deleted rows out, and every query does too.
  - A table that grows for good, such as a log or an event table, says how long its rows are kept and what removes them.
  - History is kept append-only: its rows are added, never changed.
  - A row the stories say is gone loses its personal fields, even when the row is kept, soft-deleted, or archived; history holds ids rather than personal data, or says how it is erased.

## Migrations

- **DATA-MIGRATE.** The schema changes only through migrations.
  - A migration that has run anywhere is never edited; a change is a new migration.
  - Each migration makes one change, and a schema change is not mixed with filling in data. A lookup table's rows go in a migration of their own; a table rebuilt to change it, as SQLite needs, is one change with its copy.
  - A migration can be undone, or says it cannot.
  - Seed and sample data are not in migrations; a lookup table's rows are not seed data.
  - A schema dump the project keeps, such as `structure.sql`, changes in the same commit.
- **The model.** CS-DATA, in [code-standards.md](code-standards.md), holds the schema to the area's `data-model.md`, and the model reads at a glance, as the kit's `templates/data-model.md` shows.

## This project's

The conventions of the database this project uses, from the kit's `templates/data-engines/<engine>.md`, and any rule the project adds. Step 3 copies the engine's file here when the store is picked; the IDs keep their engine prefix, such as `PG-` or `SQLITE-`.

<!-- wf:local data -->

## Sources

The rules added on 2026-11-21 come from these; each link was checked that day.

- General: the [SQL style guide](https://www.sqlstyle.guide/), GitLab's database guides on [foreign keys](https://docs.gitlab.com/development/database/foreign_keys/), [constraint names](https://docs.gitlab.com/development/database/constraint_naming_convention/), and [text](https://docs.gitlab.com/development/database/strings_and_the_text_data_type/), Rails' [migrations guide](https://guides.rubyonrails.org/active_record_migrations.html), Martin Fowler on [evolutionary database design](https://www.martinfowler.com/articles/evodb.html), and Brandur Leach on [soft deletion](https://brandur.org/soft-deletion).
- Postgres: the wiki's [Don't Do This](https://wiki.postgresql.org/wiki/Don't_Do_This), and the manual on [UUIDs](https://www.postgresql.org/docs/18/functions-uuid.html), [enums](https://www.postgresql.org/docs/current/datatype-enum.html), [JSON](https://www.postgresql.org/docs/current/datatype-json.html), and [citext](https://www.postgresql.org/docs/18/citext.html).
- SQLite: [foreign keys](https://www.sqlite.org/foreignkeys.html), [STRICT tables](https://www.sqlite.org/stricttables.html), [quirks](https://www.sqlite.org/quirks.html), [AUTOINCREMENT](https://www.sqlite.org/autoinc.html), and [WITHOUT ROWID](https://www.sqlite.org/withoutrowid.html).
- MySQL: the reference manual on [utf8mb3](https://dev.mysql.com/doc/refman/8.4/en/charset-unicode-utf8mb3.html), [InnoDB](https://dev.mysql.com/doc/refman/8.4/en/innodb-introduction.html), and [DATETIME and TIMESTAMP](https://dev.mysql.com/doc/refman/8.4/en/datetime.html); its site refuses automated checks, so these were checked by their address only.
- MongoDB: [schema validation](https://www.mongodb.com/docs/manual/core/schema-validation/), [embedding or referencing](https://www.mongodb.com/docs/manual/data-modeling/concepts/embedding-vs-references/), and the [design anti-patterns](https://www.mongodb.com/docs/manual/data-modeling/design-antipatterns/).

Left out, since a reviewer cannot judge them from a schema alone: a choice between databases, which is the owner's at Step 3, and tuning settings, which are deployment.
