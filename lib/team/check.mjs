// What a team server takes from a member's kit, checked before it is kept:
// a published page's spec, as the kit's own check made it (lib/ask/spec.mjs),
// and a project's comment kinds. The page draws only text and fixed
// attributes, so this keeps a bad page from breaking the inbox or the page
// for others, and a hash or a picture name from naming any other file.

import { BLOCK_KINDS, BLOCK_LIMITS } from "../ask/blocks.mjs";
import { HASH } from "../ask/live.mjs";
import { ID } from "../ask/store.mjs";
import { TYPES } from "../ask/questions.mjs";

const QID = /^[A-Za-z0-9][A-Za-z0-9_.-]{0,63}$/;
const PICTURE_SRC = /^p\/\d{1,3}\.(png|jpe?g|gif|webp|svg)$/;
const COLOR = /^(#[0-9a-fA-F]{3,8}|hsl\([0-9., %]{1,40}\))$/;
const isMap = (v) => Boolean(v) && typeof v === "object" && !Array.isArray(v);
const text = (v, most = 20_000) => v == null || (typeof v === "string" && v.length <= most);
const list = (v, most, each) => v == null || (Array.isArray(v) && v.length <= most && v.every(each));

/** Blocks the kit checked and made ready: a list of kinds the page draws, small enough. */
export function drawableBlocks(blocks, { most = BLOCK_LIMITS.live, questions = false } = {}) {
  const kinds = BLOCK_KINDS.filter((k) => k !== "part" && (questions || (k !== "questions" && k !== "pictures")));
  return Array.isArray(blocks) && blocks.length <= most && JSON.stringify(blocks).length <= 512 * 1024 && blocks.every((b) => isMap(b) && kinds.includes(b.type) && text(b.title, 200) && text(b.note, 400));
}

const picture = (p) => isMap(p) && PICTURE_SRC.test(String(p.src ?? "")) && text(p.label, 200) && text(p.name, 200) && list(p.boxes, 100, (b) => isMap(b) && Array.isArray(b.rect) && b.rect.every(Number.isFinite));
const option = (o) => isMap(o) && QID.test(String(o.id)) && text(o.label, 400) && text(o.why, 2000) && text(o.preview, 4000) && text(o.kind, 40);

/** Why a published spec is not one the kit made, or "" when it is. */
export function specProblem(spec, id) {
  if (!isMap(spec) || spec.id !== id || !ID.test(String(spec.id))) return "a page is its spec, with this id";
  if (!HASH.test(String(spec.hash))) return "a page's hash is the kit's: twelve hex digits";
  if (!text(spec.title, 400) || !text(spec.intro, 20_000) || !text(spec.template, 40) || !text(spec.layout, 40)) return "the title, intro, template, and layout are text";
  if (!Array.isArray(spec.questions) || spec.questions.length > 300) return "a page has at most 300 questions";
  for (const q of spec.questions) {
    if (!isMap(q) || !QID.test(String(q.id)) || !text(q.text, 2000) || !TYPES.includes(q.type)) return "each question has an id, its text, and a type the kit knows";
    if (!list(q.options, 100, option) || !list(q.pictures, 20, picture) || !(q.compare == null || (Array.isArray(q.compare) && q.compare.length === 2 && q.compare.every(picture)))) return `${q.id}: its options or pictures are not as the kit makes them`;
    if (!list(q.rows, 100, (r) => isMap(r) && QID.test(String(r.id))) || !list(q.edits, 100, (e) => isMap(e) && QID.test(String(e.id)) && Array.isArray(e.ops)) || !list(q.fields, 50, (f) => isMap(f) && QID.test(String(f.id)))) return `${q.id}: its rows, edits, or fields are not as the kit makes them`;
    if (q.more != null && !drawableBlocks(q.more)) return `${q.id}: its details are not blocks the page draws`;
  }
  if (spec.sections != null && !list(spec.sections, 60, (s) => isMap(s) && drawableBlocks(s.blocks, { most: BLOCK_LIMITS.blocks, questions: true }))) return "its sections hold blocks the page draws";
  if (spec.more != null && !drawableBlocks(spec.more)) return "its details are not blocks the page draws";
  if (!list(spec.for, 20, (f) => typeof f === "string" && f.length <= 40)) return "for names roles, client, or people";
  if (spec.asker != null && askerProblem(spec.asker)) return askerProblem(spec.asker);
  return "";
}

const ASKER_KEYS = ["project", "branch", "worktree", "session", "commit", "repo"];
// A repository's web address, which the page links its branch, commit, and pull request to: https, a host, and a path of plain parts.
const REPO = /^https:\/\/[A-Za-z0-9.-]+(?::\d{1,5})?(?:\/[A-Za-z0-9._~-]+){1,6}$/;
/** Why who asks is not as the kit's asker() makes it, or "": its own fields only, each a few words, the repository an https address and the commit hex. */
export function askerProblem(asker) {
  if (!isMap(asker) || !Object.keys(asker).every((k) => ASKER_KEYS.includes(k)) || !Object.values(asker).every((v) => text(v, 200))) return "who asks is the kit's few words: project, branch, worktree, session, commit, repo";
  if (asker.repo && !REPO.test(asker.repo)) return "who asks names its repository as an https address";
  if (asker.commit && !/^[0-9a-f]{7,40}$/.test(asker.commit)) return "who asks names its commit in hex";
  return "";
}

/** A project's comment kinds, each a word, a colour, and what it is for; or null when they are not. */
export function cleanKinds(kinds) {
  if (!isMap(kinds) || Object.keys(kinds).length > 30) return null;
  const out = {};
  for (const [id, k] of Object.entries(kinds)) {
    if (!/^[a-z][a-z0-9-]{0,29}$/.test(id) || !isMap(k) || !COLOR.test(String(k.color ?? "")) || !text(k.word, 60) || !text(k.use, 300)) return null;
    out[id] = { color: k.color, word: k.word ?? id, use: k.use ?? "" };
  }
  return out;
}
