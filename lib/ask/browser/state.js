// What an answer is, and every way the page changes one, in one place: a
// question's own controls, the bulk actions, and the send panel all call
// these, so they cannot drift apart. Plain functions over the answers map,
// with no page in them, so the kit's checks (lib/ask/answers.mjs) load this
// file too and the page and the record read one rule.
window.wfAskState = (() => {
  "use strict";
  const has = (map) => Boolean(map && typeof map === "object" && Object.keys(map).length);
  const every = (map, list) => list.length > 0 && list.every((each) => map?.[each.id] != null);
  /** What is wrong with one form field's value, or "": empty when required, a number out of range, an unknown choice. */
  function fieldProblem(f, value) {
    const empty = value == null || value === "" || value === false;
    if (empty) return f.required ? (f.kind === "check" ? "Tick this to go on." : "This one is needed.") : "";
    if (f.kind === "check") return typeof value === "boolean" ? "" : "A tick, or none.";
    if (f.kind === "number") {
      if (typeof value !== "number" || !Number.isFinite(value)) return "A number.";
      if (f.min != null && value < f.min) return `At least ${f.min}.`;
      if (f.max != null && value > f.max) return `At most ${f.max}.`;
      return "";
    }
    if (typeof value !== "string") return "Text.";
    if (f.kind === "select") return f.options.some((o) => o.id === value) ? "" : "One of the choices.";
    if (f.kind === "date") return /^\d{4}-\d{2}-\d{2}$/.test(value) && !Number.isNaN(Date.parse(value)) ? "" : "A date, such as 2026-11-13.";
    const most = f.max ?? (f.kind === "long" ? 2000 : 300);
    return value.length > most ? `At most ${most} characters.` : "";
  }
  /** Whether a number is on a scale: from its min to its max, on a step. */
  function onScale(sc, n) {
    if (!sc || typeof n !== "number" || !Number.isFinite(n) || n < sc.min || n > sc.max) return false;
    const steps = (n - sc.min) / sc.step;
    return Math.abs(steps - Math.round(steps)) < 1e-9;
  }
  /** Whether a form is done: every field fine, and something filled in. */
  function formDone(q, fields) {
    if (!q.fields.every((f) => !fieldProblem(f, fields?.[f.id]))) return false;
    return q.fields.some((f) => f.required) || Object.values(fields ?? {}).some((x) => x != null && x !== "" && x !== false);
  }
  /**
   * Whether a question has an answer: a choice, an order, text, a number, or a
   * decide; a grid, a sort, or edits with every row placed; a form filled in.
   */
  function answered(v, q) {
    if (!v) return false;
    if (v.decide || v.choice != null || v.order || v.text || v.other || v.number != null) return true;
    if (has(v.rows)) return every(v.rows, q.rows);
    if (has(v.edits)) return every(v.edits, q.edits);
    if (has(v.fields)) return formDone(q, v.fields);
    return false;
  }
  /** How far a grid, a sort, or edits has got: `{ done, total }`, or null for a question that places nothing. */
  function progressOf(q, v) {
    const list = q.type === "edits" ? q.edits : q.type === "grid" || q.type === "buckets" ? q.rows : null;
    if (!list) return null;
    const map = q.type === "edits" ? v?.edits : v?.rows;
    return { done: list.filter((each) => map?.[each.id] != null).length, total: list.length };
  }
  /**
   * Whether a follow-up shows: its `showIf` names an earlier question, and
   * `is` (options picked), `not`, `atLeast`, `atMost` (a number), or, with
   * none of them, that it is answered. A question left to the agent or for
   * later shows no follow-ups, and a follow-up of a hidden one is hidden.
   */
  function shown(q, A, byId) {
    const c = q.showIf;
    if (!c) return true;
    const parent = byId.get(c.question);
    if (!parent || !shown(parent, A, byId)) return false;
    const v = A[c.question];
    if (!answered(v, parent) || v.decide) return false;
    const picks = v.choice == null ? [] : Array.isArray(v.choice) ? v.choice : [v.choice];
    if (c.is && !c.is.some((id) => picks.includes(id))) return false;
    if (c.not && c.not.some((id) => picks.includes(id))) return false;
    if (c.atLeast != null && !(v.number >= c.atLeast)) return false;
    if (c.atMost != null && !(v.number <= c.atMost)) return false;
    return true;
  }
  /** The options a question recommends, as a list. */
  const recs = (q) => (Array.isArray(q.recommended) ? q.recommended : q.recommended != null && typeof q.recommended !== "object" ? [q.recommended] : []);

  /** Clear what an answer said, keeping its note and its pins. */
  function clearAnswer(v) {
    delete v.choice;
    delete v.order;
    delete v.text;
    delete v.other;
    delete v.number;
    delete v.rows;
    delete v.edits;
    delete v.fields;
  }
  /** Leave a question to the agent ("agent") or for later ("later"): its answer goes, its note stays. */
  function setDecide(v, id) {
    clearAnswer(v);
    v.decide = id;
  }
  /** The same, or take it back when it is already that. */
  function toggleDecide(v, id) {
    if (v.decide === id) delete v.decide;
    else setDecide(v, id);
  }
  /** Pick options: one for a one question, the set for a many question. Any decide goes. */
  function setChoice(q, v, ids) {
    v.choice = q.type === "many" ? [...ids] : ids[0];
    if (!ids.includes("other")) delete v.other;
    delete v.decide;
  }
  /** Take what the question recommends: its options, or for a ranking the order as listed. False when it recommends nothing. */
  function takeRecommendation(q, v) {
    if (q.type === "rank") {
      clearAnswer(v);
      delete v.decide;
      v.order = q.options.map((o) => o.id);
      return true;
    }
    if (q.type === "scale" && q.recommended != null) {
      clearAnswer(v);
      delete v.decide;
      v.number = q.recommended;
      return true;
    }
    // A grid, a sort, or edits recommend a place for each row; rows already placed stay.
    const field = { grid: "rows", buckets: "rows", edits: "edits" }[q.type];
    if (field) {
      if (!has(q.recommended)) return false;
      delete v.decide;
      v[field] = { ...q.recommended, ...(v[field] ?? {}) };
      return true;
    }
    const r = recs(q);
    if (!r.length || (q.type !== "one" && q.type !== "many")) return false;
    setChoice(q, v, r);
    return true;
  }
  /** Drop empty fields, and answers with nothing left. */
  function prune(A) {
    for (const [id, v] of Object.entries(A)) {
      for (const k of Object.keys(v)) if (v[k] == null || v[k] === "" || (Array.isArray(v[k]) && !v[k].length) || (v[k] && typeof v[k] === "object" && !Array.isArray(v[k]) && !Object.keys(v[k]).length)) delete v[k];
      if (!Object.keys(v).length) delete A[id];
    }
    return A;
  }
  /** Undo and redo over snapshots of the answers, at most `max` steps back. */
  class History {
    constructor(max = 20) { this.max = max; this.back = []; this.ahead = []; }
    /** Before a change: keep how it was. */
    push(now) {
      this.back.push(JSON.stringify(now));
      if (this.back.length > this.max) this.back.shift();
      this.ahead.length = 0;
    }
    /** The answers one step back, or null; `now` is kept for redo. */
    undo(now) {
      if (!this.back.length) return null;
      this.ahead.push(JSON.stringify(now));
      return JSON.parse(this.back.pop());
    }
    redo(now) {
      if (!this.ahead.length) return null;
      this.back.push(JSON.stringify(now));
      return JSON.parse(this.ahead.pop());
    }
  }
  /**
   * The options a page describes once, above its questions: three or more
   * questions, each a choice with the same described options, such as a
   * triage's verdicts. Null when the questions differ, so each describes its own.
   */
  function sharedOptions(questions) {
    const of = (q) => (Array.isArray(q.options) && (q.type === "one" || q.type === "many") ? JSON.stringify(q.options.map((o) => [o.id, o.label, o.why ?? "", o.preview ?? ""])) : null);
    const first = questions[0] ? of(questions[0]) : null;
    if (questions.length < 3 || first == null || !questions.every((q) => of(q) === first)) return null;
    const options = questions[0].options;
    return options.some((o) => o.why) && !options.some((o) => o.preview) ? options : null;
  }
  /** Whether an answer is the recommendation and nothing more: no note, text, owner, pin, or reply to read. */
  function asRecommended(q, value) {
    if (!value || value.choice == null || !answered(value, q)) return false;
    const rec = recs(q);
    const picks = Array.isArray(value.choice) ? value.choice : [value.choice];
    if (!rec.length || picks.length !== rec.length || !picks.every((id) => rec.includes(id))) return false;
    return !value.note && !value.other && !value.text && !value.owner && !value.reply && !(value.pins && value.pins.length);
  }
  /** Whether a table's row shows under a filter: all, the open ones, or the ones not plainly as recommended. */
  const rowShows = (filter, q, value) => filter === "open" ? !answered(value, q) : filter === "other" ? !asRecommended(q, value) : true;
  /** Whether a question's options sit in one row: the page describes them once, or none has a description or a sketch. */
  const optionsInRow = (q, shared) => Boolean(shared) || (!q.other && q.options.every((o) => !o.why && !o.preview));
  /** A word as the shell reads it: plain when it is safe, else in single quotes. */
  const shellWord = (word) => (/^[A-Za-z0-9_@%+=:,./-]+$/.test(word) ? word : `'${word.replace(/'/g, "'\\''")}'`);
  /**
   * A launch page's command from its answers: the picked run's command, then
   * each shown option's flag. An option left unanswered counts as its
   * recommendation, so the command shows what would run. Null until a run is
   * picked. `launch` is the spec's { runs: { id: command }, modifiers }.
   */
  function launchCommand(launch, questions, A) {
    if (!launch) return null;
    const pick = A.run?.choice ?? null;
    if (pick == null || launch.runs[pick] == null) return null;
    const byId = new Map(questions.map((q) => [q.id, q]));
    const parts = [launch.runs[pick]];
    for (const m of launch.modifiers) {
      const q = byId.get(m.id);
      if (!q || !shown(q, A, byId)) continue;
      const v = A[m.id];
      if (m.kind === "text") {
        const words = String(v?.text ?? "").trim().split(/\s+/).filter(Boolean);
        // A function as the replacement, so no $ in the typed words is read as a pattern.
        const quoted = words.map(shellWord).join(" ");
        if (words.length) parts.push(m.flag.replace("{value}", () => quoted));
        continue;
      }
      const choice = v?.choice ?? q.recommended;
      parts.push(m.flags[choice] ?? "");
    }
    return parts.filter(Boolean).join(" ");
  }
  return { answered, progressOf, shown, launchCommand, shellWord, fieldProblem, formDone, onScale, recs, clearAnswer, setDecide, toggleDecide, setChoice, takeRecommendation, prune, sharedOptions, optionsInRow, asRecommended, rowShows, History };
})();
