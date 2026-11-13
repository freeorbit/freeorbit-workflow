// Small display helpers the ask pages and the inbox share, so a label reads
// the same in both.
window.wfAskShared = (() => {
  "use strict";
  const clock = (d = new Date()) => d.toTimeString().slice(0, 5);
  /** How long ago a time was, in words. */
  const ago = (iso) => {
    const s = Math.max(0, (Date.now() - Date.parse(iso)) / 1000);
    return s < 60 ? "just now" : s < 3600 ? `${Math.round(s / 60)} min ago` : s < 86400 ? `${Math.round(s / 3600)} h ago` : `${Math.round(s / 86400)} d ago`;
  };
  /** Who asked, in one line: the repository, the worktree or branch, and the session. */
  const askerLabel = (asker, fallback = "") => [asker?.project || fallback, asker?.worktree || asker?.branch, asker?.session ? `session ${String(asker.session).replace(/^local_/, "").slice(0, 8)}` : ""].filter(Boolean).join(" · ");
  /** This browser's storage, which a private window may refuse: a read gives the fallback, a write is skipped. */
  const store = {
    get(k, fallback = null) { try { const v = localStorage.getItem(k); return v == null ? fallback : JSON.parse(v); } catch { return fallback; } },
    set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); return true; } catch { return false; } },
    drop(k) { try { localStorage.removeItem(k); } catch { /* nothing kept */ } },
  };
  /**
   * One CSV cell. A cell a spreadsheet would read as a formula (it starts
   * with =, +, -, @, a tab, or a return, and is not a plain number) gets a
   * leading ' so it opens as text; a cell with a comma, a quote, or a line
   * break is quoted.
   */
  const csvCell = (value) => {
    let s = String(value ?? "");
    if (/^[=+\-@\t\r]/.test(s) && !/^[+-]?\d[\d.,]*(e[+-]?\d+)?%?$/i.test(s)) s = `'${s}`;
    return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  return { clock, ago, askerLabel, store, csvCell };
})();
