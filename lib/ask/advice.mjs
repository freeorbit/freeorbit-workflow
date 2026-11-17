// Advice on a page that builds but could ask better: grouping, the template
// it fits, its pictures, and the wording problems that stop it.

import { TEMPLATES } from "./templates.mjs";

/** Where advice on grouping starts: questions on one page, the same options, and answers asked. */
export const GROUPING = { ungrouped: 8, sameOptions: 3, answers: 15 };

/**
 * Advice on how a page groups its questions, never a problem: a page still
 * builds, since splitting it is sometimes the better call. A long list with
 * no groups, questions that share their options (one grid asks them
 * together), and more answers than a person gives in a few minutes. Paged
 * and table templates ask item by item on purpose, so they get none, and a
 * batch is grouped by role already.
 */
export function groupingAdvice(spec) {
  if (spec.layout !== "list" && spec.layout !== "groups") return [];
  const advice = [];
  const qs = spec.questions;
  // Groups, or questions placed in more than one place: several sections or several questions blocks.
  const placed = spec.sections?.reduce((n, s) => n + s.blocks.filter((b) => b.type === "questions").length, 0) ?? 0;
  const grouped = qs.some((q) => q.group) || placed > 1;
  if (qs.length > GROUPING.ungrouped && !grouped) advice.push(`${qs.length} questions and no groups: give each question a group that says what it decides, or place them in sections, so related ones sit together`);
  const bySet = new Map();
  // A template that makes each item's question with its own verdicts shares them on purpose.
  for (const q of TEMPLATES[spec.template]?.asWritten ? qs.filter((x) => (x.type === "one" || x.type === "many") && !x.showIf) : []) {
    const key = `${q.type}|${q.options.map((o) => `${o.id}=${o.label}`).join("|")}`;
    bySet.set(key, [...(bySet.get(key) ?? []), q.id]);
  }
  for (const ids of bySet.values()) if (ids.length >= GROUPING.sameOptions) advice.push(`${ids.join(", ")} share the same options: one grid question, with a row for each, asks them together`);
  // A follow-up may never be asked, so it is not counted.
  const answers = qs.filter((q) => !q.showIf).reduce((n, q) => n + (q.type === "grid" || q.type === "buckets" ? q.rows.length : q.type === "edits" ? q.edits.length : q.type === "form" ? q.fields.length : 1), 0);
  if (answers > GROUPING.answers && !spec.steps) advice.push(`about ${answers} answers on one page: split it into steps ("steps": true with sections), or ask what blocks the work now and the rest on a second page`);
  return advice;
}

/**
 * Advice where a page asks with `decision` what another template is made
 * for: questions for several roles (batch), the open questions log (triage),
 * the same Accept, Defer, Reject on many items (triage with its verdicts),
 * pictures each given a verdict (frame-review, or compare for pairs), and,
 * on a batch page too, many rules judged in one question (testdata).
 */
export function templateAdvice(spec) {
  if (spec.template !== "decision" && spec.template !== "batch") return [];
  const advice = [];
  const qs = spec.questions;
  // A question that names several rules at once lets them be judged only together.
  const bundled = qs.filter((q) => (q.text.match(/\bR-\d+\b/g) ?? []).length >= GROUPING.sameOptions);
  if (bundled.length) advice.push(`${bundled.map((q) => q.id).join(", ")} ${bundled.length === 1 ? "judges" : "judge"} several rules in one question: a testdata page gives each rule its row, fine, a gap, or wrong, a table each category`);
  if (spec.template !== "decision") return advice;
  const roles = new Set(qs.map((q) => q.role).filter(Boolean));
  if (roles.size >= 2 && qs.filter((q) => q.role).length >= GROUPING.sameOptions) advice.push(`${qs.length} questions for ${roles.size} roles (${[...roles].join(", ")}): a batch page groups them under each role`);
  const logged = qs.filter((q) => /^Q-\d+\b/.test(q.text));
  if (logged.length >= GROUPING.sameOptions) advice.push(`${logged.map((q) => q.text.match(/^Q-\d+/)[0]).join(", ")} are open questions: a triage page answers, keeps, or drops each`);
  const verdict = (q) => { const ids = q.options.map((o) => o.id.toLowerCase()); return ids.some((id) => /^accept/.test(id)) && ids.some((id) => /^reject/.test(id)); };
  const findings = qs.filter(verdict);
  if (findings.length >= GROUPING.sameOptions) advice.push(`${findings.length} questions accept or reject an item each: a triage page with those options as its verdicts asks them as one list`);
  const judged = qs.filter((q) => (q.pictures.length || q.compare) && q.options.length && q.options.every((o) => o.kind));
  if (judged.length >= GROUPING.sameOptions) advice.push(`${judged.length} pictures each given a verdict: ${judged.every((q) => q.compare) ? "a compare page" : "a frame-review page"} shows them one at a time, with a filmstrip of verdicts`);
  return advice;
}

/** Where a picture looks like a joined sheet: wider than this for its height, or than this at all. */
export const SHEET = { ratio: 2.6, wide: 2400, widest: 4000 };

/**
 * Advice on a page's pictures, once their sizes are known: a joined sheet of
 * several frames, a question that names a box its pictures do not have, and
 * a frame against the app with no compare pair. Each says what to use.
 */
export function pictureAdvice(spec) {
  const advice = [];
  for (const q of spec.questions) {
    const all = [...q.pictures, ...(q.compare ?? [])];
    for (const p of all) {
      const sheet = p.w && p.h && ((p.w / p.h > SHEET.ratio && p.w > SHEET.wide) || p.w > SHEET.widest);
      if (sheet) advice.push(`${q.id}: picture ${p.label || p.name || p.image} is ${p.w}×${p.h}, likely several frames joined in one sheet; give each its own picture with npx wf design annotate --ask, and a frame against the app as one compare pair`);
    }
    const said = [q.text, q.look, q.detail].join(" ");
    const boxed = /\bbox(es)?\s+\d/i.test(said);
    if (boxed && !all.length) advice.push(`${q.id}: names a box, but shows no picture; give the question its own pictures, with their boxes as data (npx wf design annotate --ask)`);
    else if (boxed && !all.some((p) => p.boxes.length)) advice.push(`${q.id}: names a box, but its pictures have none the page can draw; give the boxes as data (npx wf design annotate --ask), so they light up and take pins`);
    // A pair with nothing marked leaves the person to hunt for what differs.
    if (q.compare && !q.compare.some((p) => p.boxes.length)) advice.push(`${q.id}: a compare pair with no box; mark what differs or where to look with npx wf design annotate --ask, so the person need not hunt for it`);
    if (!q.compare && /\bframes?\b/i.test(said) && /\bapp\b/i.test(said) && all.length < 2) advice.push(`${q.id}: ${all.length ? "compares a frame with the app in one picture" : "is about a frame and the app, and shows neither"}; a compare pair, [frame, app], shows them side by side, by swipe, or as a difference`);
  }
  return advice;
}

/**
 * Wording held short, so every page reads evenly: a question and a label say
 * one thing, and a reason or a description is one sentence. A question with
 * `explain: true`, asked for when the person wants more detail or a follow-up
 * runs deeper, may give its reasons and descriptions room.
 */
export const LIMITS = { text: 160, label: 60, why: 200, optionWhy: 160, detail: 300, look: 200, explained: 1200 };

export function lengthProblems(questions) {
  const problems = [];
  const over = (where, value, max) => {
    if (value && value.length > max) problems.push(`${where} is ${value.length} characters, over ${max}; say it shorter${max < LIMITS.explained ? ", or set explain: true where more detail was asked for" : ""}`);
  };
  for (const q of questions) {
    const roomy = (max) => (q.explain ? LIMITS.explained : max);
    over(`${q.id}: the question`, q.text, LIMITS.text);
    over(`${q.id}: why`, q.why, roomy(LIMITS.why));
    over(`${q.id}: noPick`, q.noPick, roomy(LIMITS.why));
    over(`${q.id}: detail`, q.detail, roomy(LIMITS.detail));
    over(`${q.id}: look`, q.look, LIMITS.look);
    for (const o of q.options) {
      over(`${q.id}: option ${o.id}'s label`, o.label, LIMITS.label);
      over(`${q.id}: option ${o.id}'s why`, o.why, roomy(LIMITS.optionWhy));
    }
    for (const r of q.rows) {
      over(`${q.id}: ${r.id}'s label`, r.label, LIMITS.text);
      over(`${q.id}: ${r.id}'s why`, r.why, roomy(LIMITS.optionWhy));
    }
    for (const e of q.edits) {
      over(`${q.id}: edit ${e.id}'s label`, e.label, LIMITS.label);
      over(`${q.id}: edit ${e.id}'s why`, e.why, roomy(LIMITS.optionWhy));
    }
    for (const f of q.fields) {
      over(`${q.id}: field ${f.id}'s label`, f.label, LIMITS.label);
      over(`${q.id}: field ${f.id}'s help`, f.help, roomy(LIMITS.optionWhy));
    }
    if (q.scale) for (const k of ["low", "high"]) over(`${q.id}: the scale's ${k}`, q.scale[k], LIMITS.label);
  }
  return problems;
}

/** A choice with no recommendation and why, or a noPick with one, by the asking rules. */
export function adviceProblems(questions) {
  const problems = [];
  for (const q of questions) {
    if (q.type === "text" || q.type === "form") continue;
    // Each edit says why it is suggested, as each option says what it means.
    const bareEdits = q.edits.filter((each) => !each.why).map((each) => each.id);
    if (bareEdits.length) problems.push(`${q.id}: every edit says why it is suggested, in why; ${bareEdits.join(", ")} ${bareEdits.length === 1 ? "does" : "do"} not`);
    // Each option says what it means, so the ones not recommended are understood too.
    const bare = q.options.filter((each) => !each.why).map((each) => each.id);
    if (bare.length) problems.push(`${q.id}: every option says what it means, in why; ${bare.join(", ")} ${bare.length === 1 ? "does" : "do"} not`);
    const what = q.type === "rank" ? "a suggested order" : "a recommendation";
    if (q.noPick) {
      if (q.recommended != null) problems.push(`${q.id}: noPick says there is no recommendation, but it recommends ${JSON.stringify(q.recommended)}`);
      continue;
    }
    const how = { scale: "give the number", grid: "place the rows", buckets: "place the items", edits: "accept or reject the edits" }[q.type] ?? "name the option";
    if (q.type !== "rank" && q.recommended == null) problems.push(`${q.id}: ${what}: ${how} in recommended, or say in noPick why there is none`);
    if (!q.why) problems.push(`${q.id}: ${what} says why, in why${q.type === "rank" ? " at the top of the spec" : ""}`);
  }
  return problems;
}

/** Every picture in the spec, in page order, so the page build can copy each once. */
export function pictures(spec) {
  const inBlocks = (blocks) => blocks.filter((b) => b.type === "pictures").flatMap((b) => b.items);
  return [
    ...spec.questions.flatMap((each) => [...each.pictures, ...(each.compare ?? [])]),
    ...inBlocks((spec.sections ?? []).flatMap((s) => s.blocks)),
    ...inBlocks(Object.values(spec.launch?.details ?? {}).flat()),
  ];
}
