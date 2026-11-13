# A project's own ask templates

A template kept as data in the project, for the `ask-page` skill.

When none of the templates fits a question that will come back, such as a dependency review, propose a project template to the owner. Ask first; it is a file in the project, committed like any other.

- **Where.** `.workflow/ask-templates/<name>.json`. `npx wf ask templates` lists it beside the kit's and names what is wrong with it.
- **What.** Data only, never code: `name`, `use`, `layout` (`list`, `pages`, `groups`, `table`), `items` (the spec's field that lists them), `text` and `detail` with `{field}` and `{n}`, `type`, `options`, `advised`, `pins`, `defer`, `other`, `groupBy`, and `columns` for a table.
- **Advised.** `advised: true` holds its choices to the asking rules: a recommendation, why, and what each option means.
- **The example.** `project-template/dependency-review.json` beside this skill, and the spec that uses it.
- **Why not code.** The page takes answers on this machine; a template that ran its own script could send anything. A layout the kit lacks is a change to the kit.
