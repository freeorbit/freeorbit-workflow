import { test } from "node:test";
import assert from "node:assert/strict";

import { tokenFrom } from "../lib/board/envfile.mjs";

const NAME = "MONDAY_API_TOKEN";
const gitWith = ({ tracked = "", rule = ".gitignore:3:.env\t.env" } = {}) => (args) =>
  args[0] === "ls-files" ? tracked : args[0] === "check-ignore" ? rule : "";
const file = (text) => () => text;

test("the environment wins over .env", () => {
  const read = () => assert.fail(".env read although the environment has the token");
  assert.deepEqual(tokenFrom("/repo", NAME, { env: { [NAME]: "from-env" }, git: gitWith(), readEnvFile: read }), { token: "from-env" });
});

test("a gitignored .env gives the token", () => {
  const text = "# monday\nOTHER=1\nMONDAY_API_TOKEN=\"abc.def-123\"\n";
  assert.deepEqual(tokenFrom("/repo", NAME, { env: {}, git: gitWith(), readEnvFile: file(text) }), { token: "abc.def-123" });
});

test("no .env, or one without the name, gives nothing", () => {
  assert.deepEqual(tokenFrom("/repo", NAME, { env: {}, git: gitWith(), readEnvFile: file(null) }), {});
  assert.deepEqual(tokenFrom("/repo", NAME, { env: {}, git: gitWith(), readEnvFile: file("OTHER=1\n") }), {});
});

test("a tracked .env is refused, naming no token", () => {
  const got = tokenFrom("/repo", NAME, { env: {}, git: gitWith({ tracked: ".env\n" }), readEnvFile: file(`${NAME}=secret-value\n`) });
  assert.equal(got.token, undefined);
  assert.match(got.problem, /tracked by git/);
  assert.doesNotMatch(got.problem, /secret-value/);
});

test("a .env git does not ignore is refused", () => {
  for (const rule of ["", ".gitignore:4:!.env\t.env"]) {
    const got = tokenFrom("/repo", NAME, { env: {}, git: gitWith({ rule }), readEnvFile: file(`${NAME}=secret-value\n`) });
    assert.equal(got.token, undefined);
    assert.match(got.problem, /not in \.gitignore/);
  }
});
