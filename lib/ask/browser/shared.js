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
  /**
   * Notifications, which the person turns on: an ask that starts waiting is
   * told once across every open tab (the asks already waiting when they turn
   * it on are not news), and a page tells its own replies and a live page
   * finishing. `tag` keeps one notification per thing.
   *
   * The server shows them on the desktop when this machine can, since
   * Claude's built-in browser pane, like some browsers, shows no web
   * notification; the browser's own are the fallback. A page sets its key, id,
   * and token with `configure`, then `init` asks the server.
   */
  const notifier = {
    desktop: false,
    page: null,
    configure(page) { this.page = page; },
    async init() {
      if (!this.page?.token) return;
      try { this.desktop = (await (await fetch("/__hub", { cache: "no-store" })).json()).notify === true; } catch { this.desktop = false; }
    },
    browser: () => typeof Notification === "function",
    supported() { return this.desktop || this.browser(); },
    on() { return store.get("wf-ask:notify", false) === true && (this.desktop || (this.browser() && Notification.permission === "granted")); },
    async enable() {
      const answer = this.desktop ? "granted" : this.browser() ? await Notification.requestPermission() : "denied";
      store.set("wf-ask:notify", answer === "granted");
      store.drop("wf-ask:notified");
      return answer;
    },
    disable() { store.set("wf-ask:notify", false); },
    // Away means another tab, or the chat beside the pane: the page is not what has the keys.
    away: () => document.hidden || !document.hasFocus(),
    show(title, body, tag, href) {
      if (this.desktop) {
        const { key, id, token } = this.page;
        fetch("/__hub/notify", { method: "POST", headers: { "Content-Type": "application/json", "X-WF-Token": token }, body: JSON.stringify({ key, id, title, body }) }).catch(() => {});
        return;
      }
      try {
        const n = new Notification(title, { body, tag });
        n.onclick = () => { window.focus(); if (href) location.assign(href); n.close(); };
      } catch { /* some browsers allow notifications only from a service worker */ }
    },
    tell(title, body, tag) {
      if (this.on() && this.away()) this.show(title, body, tag);
    },
    check(items, here = "") {
      if (!this.on()) return;
      const known = store.get("wf-ask:notified", null);
      const seen = new Set(known ?? []);
      const fresh = items.filter((i) => (i.state === "waiting" || i.state === "partial") && !seen.has(`${i.href}|${i.asked}`));
      for (const i of fresh) seen.add(`${i.href}|${i.asked}`);
      store.set("wf-ask:notified", [...seen].slice(-300));
      if (!known) return;
      for (const i of fresh) if (i.href !== here) this.show(`${i.asker?.project || i.project}: ${i.title}`, "An agent is waiting on this ask.", `${i.href}|${i.asked}`, i.href);
    },
  };
  return { clock, ago, askerLabel, store, csvCell, notifier };
})();
