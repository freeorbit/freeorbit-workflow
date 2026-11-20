### MySQL

The project's database is MySQL. These hold beside the general data rules (from the kit's templates/data-engines/mysql.md).

- **Table names.** <Singular or plural: pick one.>
- **MYSQL-CHARSET.** Text is `utf8mb4`, never `utf8` or `utf8mb3`, which cannot hold every character.
- **MYSQL-ENGINE.** Every table is InnoDB, which has foreign keys and transactions; never MyISAM.
- **MYSQL-TIME.** An instant is `datetime` in UTC, not `timestamp`, which turns with the session's zone and ends in 2038.
- **MYSQL-KEY.** A guideline, not a hard rule. Every table has an explicit primary key, since it orders the table on disk. A UUID key is `binary(16)` and time-ordered, not `char(36)`.
