// `wf testdata rename-ids [area] [--write]`: qualify each area's old IDs with
// its prefix, so every ID is unique across the app: R-12 becomes R-GM-12,
// C-41 C-GM-41, G-03 G-GM-03, and a dataset D27 DS-GM-27. The number is kept
// as written, so D6 becomes DS-GM-6 and D06 DS-GM-06.
//
// Which area an old ID is:
//   - in an area's docs folder, that area's, whether its spec defines it now
//     or it was retired;
//   - in a path the area's id names (plugins/uplink/, decisions/uplink.md), or
//     one of its `code` paths, that area's when it defines the ID or its docs
//     name it; one another area defines is listed for a person, since the
//     place and the definition disagree;
//   - anywhere else, the one area that defines it, or the one whose docs name
//     it, or the one area whose stories or decisions the same line cites, such
//     as GM-07 or D-GM-101, when that area knows the ID.
// Anything else is listed for a person, never guessed.
//
// In code an ID is renamed only inside comments and string literals, so
// `const D23` stays a name. A data file (JSON, TOML, YAML) outside the tests
// and fixtures is product data and left alone, as are the kit's own docs,
// which `wf docs sync` writes. Without --write nothing is written.

import { kitDocs, placeOf } from "./docs/docsync.mjs";
import { OLD, OLD_IN_TEXT as TOKEN, TEXT, decisionPattern, qualify, storyPattern } from "./ids.mjs";
import { specIds } from "./testdata.mjs";

const CODE = /\.(rs|ts|tsx|js|mjs|cjs|py)$/;
const DATA = /\.(toml|json|ya?ml)$/;
const TESTS = /(^|\/)(tests?|fixtures|testdata|test-data|e2e)(\/|$)|[._-](test|spec)\.[a-z]+$|_tests?\.rs$/;

/** The area a code or doc path belongs to, or null when none or several claim it. */
export function areaOfPath(path, areas) {
  const parts = path.split("/");
  const stem = parts.at(-1).replace(/\.[^.]+$/, "");
  const claims = areas.filter((area) => (area.docs && path.startsWith(`${area.docs}/`)) || (area.code ?? []).some((prefix) => path.startsWith(prefix)) || parts.slice(0, -1).includes(area.id) || stem === area.id);
  return claims.length === 1 ? claims[0] : null;
}

/**
 * The comments and string literals of a source file, as [start, end) offsets:
 * the only places an ID is text in code. Rust, JavaScript and TypeScript, and
 * Python; multi-line strings and comments included, and a template literal
 * without its ${…} parts. A regex literal, and a Python f-string's {…}, are
 * read as plain text.
 */
export function textSpans(text, path) {
  const rust = path.endsWith(".rs");
  const py = path.endsWith(".py");
  const spans = [];
  let i = 0;
  const n = text.length;
  const quoted = (q, from) => {
    let j = from;
    while (j < n && text[j] !== q) j += text[j] === "\\" ? 2 : 1;
    return Math.min(j + 1, n);
  };
  while (i < n) {
    const c = text[i];
    const two = text.slice(i, i + 2);
    let end = -1;
    if ((!py && two === "//") || (py && c === "#")) end = text.indexOf("\n", i) === -1 ? n : text.indexOf("\n", i);
    else if (!py && two === "/*") {
      // Rust block comments nest.
      let depth = 0;
      let j = i;
      while (j < n) {
        if (text.startsWith("/*", j)) { depth++; j += 2; } else if (text.startsWith("*/", j)) { depth--; j += 2; if (!depth || !rust) break; } else j++;
      }
      end = j;
    } else if (rust && /[rb]/.test(c) && /^(b?r)(#*)"/.test(text.slice(i, i + 40)) && !/[A-Za-z0-9_]/.test(text[i - 1] ?? "")) {
      const [, , hashes] = /^(b?r)(#*)"/.exec(text.slice(i, i + 40));
      const close = text.indexOf(`"${hashes}`, i + text.slice(i).indexOf('"') + 1);
      end = close === -1 ? n : close + 1 + hashes.length;
    } else if (py && (text.startsWith('"""', i) || text.startsWith("'''", i))) {
      const close = text.indexOf(text.slice(i, i + 3), i + 3);
      end = close === -1 ? n : close + 3;
    } else if (c === "`" && !rust && !py) {
      // A template literal is text, but each ${…} in it is code: `${D10}` names a variable.
      let j = i + 1;
      let from = i;
      while (j < n && text[j] !== "`") {
        if (text[j] === "\\") { j += 2; continue; }
        if (text.startsWith("${", j)) {
          spans.push([from, j]);
          let depth = 1;
          j += 2;
          while (j < n && depth) { if (text[j] === "{") depth++; else if (text[j] === "}") depth--; j++; }
          from = j;
          continue;
        }
        j++;
      }
      end = Math.min(j + 1, n);
      i = from;
    } else if (c === '"' || (!rust && c === "'")) end = quoted(c, i + 1);
    else if (rust && c === "'") {
      // A char literal, such as '"', or a lifetime, which holds no text.
      const m = /^'(\\.[^']*|[^'\\])'/.exec(text.slice(i, i + 12));
      i += m ? m[0].length : 1;
      continue;
    }
    if (end === -1) { i++; continue; }
    spans.push([i, end]);
    i = Math.max(end, i + 1);
  }
  return spans;
}

/** Each old ID in a file that may be renamed, with its offset and line. */
function tokensIn(text, path) {
  const found = [...text.matchAll(TOKEN)].map((m) => ({ id: m[0], at: m.index }));
  if (!CODE.test(path)) return found;
  const spans = textSpans(text, path);
  let k = 0;
  return found.filter(({ at }) => {
    while (k < spans.length && spans[k][1] <= at) k++;
    return k < spans.length && spans[k][0] <= at;
  });
}

/**
 * The renames for every area with a prefix and a docs folder, or for one:
 * `{ texts: Map(path, new text), areas: [{ id, docs, code, ids }], ambiguous: [{ path, line, id, areas }], skipped: [path] }`.
 */
export function renameIds({ config, tracked, files }, areaId = null) {
  const areas = config.areas.filter((area) => area.prefix && area.docs);
  const chosen = areas.filter((area) => !areaId || area.id === areaId);
  if (areaId && !chosen.length) throw new Error(`no area ${areaId} with a prefix and a docs folder in .workflow/config.json`);
  const kitOwned = new Set(kitDocs().map((name) => placeOf(config, name).file));
  // Each area's old IDs: those its spec defines, and those its docs name at all, retired ones too.
  const defined = new Map();
  const known = new Map();
  for (const area of areas) {
    const docs = tracked.filter((p) => p.startsWith(`${area.docs}/`) && p.endsWith(".md"));
    const spec = docs.filter((p) => p.startsWith(`${area.docs}/test-data/`));
    defined.set(area.id, new Set(specIds(spec, files).filter(({ kind, id }) => OLD[kind]?.test(id)).map(({ id }) => id)));
    known.set(area.id, new Set(docs.flatMap((p) => files(p).match(TOKEN) ?? [])));
  }
  // The areas a line names by a story or a decision ID, such as GM-07 or D-GM-101.
  const named = (line) => areas.filter((area) => storyPattern([area.prefix], "").test(line) || decisionPattern(area.prefix).test(line));
  const ownerOf = (id, path, line) => {
    const definers = areas.filter((area) => defined.get(area.id).has(id));
    const knowers = areas.filter((area) => known.get(area.id).has(id));
    const here = areaOfPath(path, areas);
    if (here && path.startsWith(`${here.docs}/`)) return { owner: here };
    if (here && (defined.get(here.id).has(id) || known.get(here.id).has(id))) return { owner: here };
    if (definers.length === 1 && !here) return { owner: definers[0] };
    if (!definers.length && knowers.length === 1 && !here) return { owner: knowers[0] };
    const cited = here ? [] : named(line).filter((area) => known.get(area.id).has(id));
    if (cited.length === 1) return { owner: cited[0] };
    if (definers.length === 1 && here) return { maybe: [definers[0], here] };
    return { maybe: definers.length ? definers : knowers.length ? knowers : here ? [here] : [] };
  };
  const texts = new Map();
  const ambiguous = [];
  const skipped = [];
  const counts = new Map(chosen.map((area) => [area.id, { id: area.id, docs: 0, code: 0, ids: defined.get(area.id).size }]));
  for (const path of tracked.filter((p) => TEXT.test(p))) {
    const text = files(path);
    if (!text || text.search(TOKEN) === -1) continue;
    const tokens = tokensIn(text, path);
    if (!tokens.length) continue;
    if (kitOwned.has(path)) continue;
    if (DATA.test(path) && !TESTS.test(path)) {
      skipped.push(path);
      continue;
    }
    let out = "";
    let last = 0;
    let changed = false;
    for (const { id, at } of tokens) {
      const lineStart = text.lastIndexOf("\n", at) + 1;
      const lineEnd = text.indexOf("\n", at);
      const { owner, maybe } = ownerOf(id, path, text.slice(lineStart, lineEnd === -1 ? text.length : lineEnd));
      if (!owner) {
        if (maybe.length) ambiguous.push({ path, line: text.slice(0, at).split("\n").length, id, areas: maybe.map((each) => each.id) });
        continue;
      }
      if (!counts.has(owner.id)) continue;
      counts.get(owner.id)[path.startsWith(`${owner.docs}/`) ? "docs" : "code"]++;
      out += text.slice(last, at) + qualify(id, owner.prefix);
      last = at + id.length;
      changed = true;
    }
    if (changed) texts.set(path, out + text.slice(last));
  }
  return { texts, areas: [...counts.values()], ambiguous: ambiguous.filter((each) => !areaId || each.areas.includes(areaId)), skipped };
}

/** The renames as lines to print. */
export function renameLines(found, { write = false, all = false } = {}) {
  const lines = found.areas.map((a) => `${a.id}: ${a.ids} old IDs; ${a.docs} mentions in its docs and ${a.code} elsewhere ${write ? "renamed" : "to rename"}.`);
  lines.push(`${found.texts.size} ${found.texts.size === 1 ? "file" : "files"} ${write ? "written" : "would change"}.`);
  if (found.ambiguous.length) {
    lines.push(`${found.ambiguous.length} old IDs left for a person, where the place does not say the area:`);
    for (const each of all ? found.ambiguous : found.ambiguous.slice(0, 25)) lines.push(`  ${each.path}:${each.line}: ${each.id} (${each.areas.join(" or ")})`);
    if (!all && found.ambiguous.length > 25) lines.push("  … --all lists every one.");
  }
  if (found.links?.length) lines.push(`${found.links.length} symbolic ${found.links.length === 1 ? "link" : "links"} left alone: ${found.links.slice(0, 5).join(", ")}${found.links.length > 5 ? ", …" : ""}`);
  if (found.skipped?.length) lines.push(`${found.skipped.length} product data ${found.skipped.length === 1 ? "file" : "files"} left alone, outside the tests and fixtures: ${found.skipped.slice(0, 5).join(", ")}${found.skipped.length > 5 ? ", …" : ""}`);
  if (!write) lines.push("Nothing written; --write applies it. Commit it alone, then run npx wf doc:check.");
  return lines;
}
