// What an answer is, and every way the page changes one, in one place: a
// question's own controls, the bulk actions, and the send panel all call
// these, so they cannot drift apart. Plain functions over the answers map,
// with no page in them, so a test loads this file and runs them.
window.wfAskState = (() => {
  "use strict";
  /** Whether a question has an answer: a choice, an order, text, or a decide. */
  const answered = (v) => Boolean(v && (v.choice != null || v.order || v.text || v.decide || v.other));
  /** The options a question recommends, as a list. */
  const recs = (q) => (Array.isArray(q.recommended) ? q.recommended : q.recommended != null ? [q.recommended] : []);

  /** Clear what an answer said, keeping its note and its pins. */
  function clearAnswer(v) {
    delete v.choice;
    delete v.order;
    delete v.text;
    delete v.other;
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
    const r = recs(q);
    if (!r.length || (q.type !== "one" && q.type !== "many")) return false;
    setChoice(q, v, r);
    return true;
  }
  /** Drop empty fields, and answers with nothing left. */
  function prune(A) {
    for (const [id, v] of Object.entries(A)) {
      for (const k of Object.keys(v)) if (v[k] == null || v[k] === "" || (Array.isArray(v[k]) && !v[k].length)) delete v[k];
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
  return { answered, recs, clearAnswer, setDecide, toggleDecide, setChoice, takeRecommendation, prune, History };
})();
