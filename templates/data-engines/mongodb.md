### MongoDB

The project's database is MongoDB, a document store. These hold beside the general data rules, apart from these (from the kit's templates/data-engines/mongodb.md):

- **Not for documents.** DATA-FK and DATA-CONSTRAINT have no foreign keys or named constraints to hold; MONGO-VALIDATE holds the shape. DATA-KEY-TYPE gives way to the ObjectId `_id`.
- **Changed for documents.** DATA-NORM and DATA-JSON's array rule give way to MONGO-EMBED: a bounded list of embedded values, or of ids by the reference pattern, is a document's own.

- **Collection names.** <Singular or plural: pick one.>
- **MONGO-VALIDATE.** A guideline, not a hard rule. A collection past its first draft has a `$jsonSchema` validator with `validationAction: "error"`, so the database holds the data model's shape.
- **MONGO-EMBED.** A guideline, not a hard rule. Data read and changed together, and bounded, is embedded; data with many items, or a life of its own, is its own collection, referred to by id.
- **MONGO-ARRAY.** No array that grows without bound, such as a document's comments or events: they are their own documents, since a document holds at most 16 MB.
- **MONGO-SHAPE.** A guideline, not a hard rule. A document stays small: a large or seldom-read field is split out. No collection per customer or per day, and frequent `$lookup` on a hot path means the data wants embedding.
- **MONGO-TYPES.** A date is a BSON date, not a string, and the validator holds it.
