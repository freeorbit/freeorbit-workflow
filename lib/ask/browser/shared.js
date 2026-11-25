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
  /**
   * The settings the server keeps for this user (lib/view/settings.mjs), in the
   * page's HTML when it was served, with the keys it keeps: they win over this
   * browser's own, which a new browser pane or a private window does not have.
   * An exported page, or one built before the server kept them, has none, and
   * reads this browser's storage alone.
   */
  const served = (() => {
    try {
      const value = JSON.parse(document.getElementById("wf-settings")?.textContent ?? "");
      return value && Array.isArray(value.keys) && value.settings && typeof value.settings === "object" ? value : null;
    } catch {
      return null;
    }
  })();
  const KEPT = served?.keys ?? [];
  const kept = new Map(KEPT.filter((k) => k in served.settings).map((k) => [k, served.settings[k]]));
  /**
   * Sends the server what changed, a moment after the last change, with the
   * page's token, which notifier.configure sets; a change before then waits for
   * it. Only the keys that changed go, so another tab's newer change to another
   * key stays, and a dropped key goes as null. A send that fails is tried again
   * with the next change, or when the page is left.
   */
  const keeper = {
    page: null,
    changed: new Set(),
    timer: null,
    later(k) {
      this.changed.add(k);
      clearTimeout(this.timer);
      this.timer = setTimeout(() => this.flush(), 400);
    },
    flush() {
      if (!this.changed.size || !this.page?.token) return;
      clearTimeout(this.timer);
      const keys = [...this.changed];
      this.changed.clear();
      const { key, id, token } = this.page;
      const settings = Object.fromEntries(keys.map((k) => [k, kept.has(k) ? kept.get(k) : null]));
      const again = () => keys.forEach((k) => this.changed.add(k));
      fetch("/__hub/settings", { method: "POST", keepalive: true, signal: AbortSignal.timeout(5000), headers: { "Content-Type": "application/json", "X-WF-Token": token }, body: JSON.stringify({ key, id, settings }) })
        .then((res) => { if (!res.ok) again(); }, again);
    },
  };
  if (served) addEventListener("pagehide", () => keeper.flush());
  const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
  /** This browser's storage, which a private window may refuse: a read gives the fallback, a write is skipped. A kept setting is read from the server's copy first, and a change to one goes to the server. */
  const store = {
    get(k, fallback = null) {
      if (kept.has(k)) return kept.get(k) ?? fallback;
      try { const v = localStorage.getItem(k); return v == null ? fallback : JSON.parse(v); } catch { return fallback; }
    },
    set(k, v) {
      // A page sets its look on every load; only a real change is sent.
      if (KEPT.includes(k) && !(kept.has(k) && same(kept.get(k), v))) { kept.set(k, v); keeper.later(k); }
      try { localStorage.setItem(k, JSON.stringify(v)); return true; } catch { return KEPT.includes(k); }
    },
    drop(k) {
      if (kept.has(k)) { kept.delete(k); keeper.later(k); }
      try { localStorage.removeItem(k); } catch { /* nothing kept */ }
    },
  };
  // The server's copy is laid into this browser's storage, so a page opened without it later still has the look.
  for (const [k, v] of kept) try { localStorage.setItem(k, JSON.stringify(v)); } catch { /* the server's copy is read instead */ }
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
    configure(page) {
      this.page = page;
      keeper.page = page;
      // Settings this browser has that the server does not yet, such as those from before it kept them, go up once.
      for (const k of KEPT) {
        if (kept.has(k)) continue;
        const v = store.get(k);
        if (v != null) { kept.set(k, v); keeper.changed.add(k); }
      }
      keeper.flush();
    },
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
    /** Mark a thing told here, such as a send a page saw as it happened, so the inbox does not tell it again. */
    seen(tag) {
      const known = store.get("wf-ask:notified", null);
      if (known) store.set("wf-ask:notified", [...new Set([...known, tag])].slice(-300));
    },
    check(items, here = "") {
      if (!this.on()) return;
      const known = store.get("wf-ask:notified", null);
      const seen = new Set(known ?? []);
      const fresh = items.filter((i) => (i.state === "waiting" || i.state === "partial") && !seen.has(`${i.href}|${i.asked}`));
      // On a team server, your own ask that someone else sent is told once.
      // A send from before the page was last asked is old news.
      const sent = items.filter((i) => i.mine && i.sentBy && i.sentBy !== i.askedBy && i.sentAt && i.sentAt >= i.asked && !seen.has(`${i.href}|sent|${i.sentAt}`));
      for (const i of fresh) seen.add(`${i.href}|${i.asked}`);
      for (const i of sent) seen.add(`${i.href}|sent|${i.sentAt}`);
      store.set("wf-ask:notified", [...seen].slice(-300));
      if (!known) return;
      for (const i of fresh) if (i.href !== here) this.show(`${i.asker?.project || i.project}: ${i.title}`, "An agent is waiting on this ask.", `${i.href}|${i.asked}`, i.href);
      for (const i of sent) if (i.href !== here) this.show(`${i.asker?.project || i.project}: ${i.title}`, `${i.sentBy} sent your ask; your agent has the answers.`, `${i.href}|sent|${i.sentAt}`, i.href);
    },
  };
  /**
   * Run `fn` every `ms` while the tab is in view, and every `hiddenMs` while it
   * is not: a tab out of view still says in its title that an agent waits, but
   * asks the server less often. Coming back into view runs it at once.
   */
  function every(fn, ms, hiddenMs = Math.max(ms, 30000)) {
    let timer = null;
    const next = () => { clearTimeout(timer); timer = setTimeout(tick, document.hidden ? hiddenMs : ms); };
    const tick = () => { Promise.resolve(fn()).finally(next); };
    document.addEventListener("visibilitychange", () => { if (!document.hidden) { clearTimeout(timer); tick(); } });
    next();
  }
  return { clock, ago, askerLabel, store, csvCell, notifier, every };
})();
