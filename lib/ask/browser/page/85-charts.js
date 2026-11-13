// One part of the ask page's script. lib/ask/page.mjs joins the parts in
// file order inside a single function, so they share its names; a part is
// not a script on its own.
  // --- charts, diagrams, timelines, boards ---------------------------------------
  // Drawn as SVG built node by node, never from a string. Colours are read
  // from the page's tokens when drawn, so a chart redraws when the look
  // changes, and an exported SVG carries the colours it was drawn in.

  const SVG_NS = "http://www.w3.org/2000/svg";
  function sv(tag, attrs, ...kids) {
    const node = document.createElementNS(SVG_NS, tag);
    for (const [k, v] of Object.entries(attrs ?? {})) {
      if (v == null || v === false) continue;
      if (k.startsWith("on")) node.addEventListener(k.slice(2), v);
      else node.setAttribute(k, String(v));
    }
    for (const kid of kids.flat()) if (kid != null && kid !== false) node.append(kid instanceof Node ? kid : document.createTextNode(String(kid)));
    return node;
  }
  const cssToken = (name) => getComputedStyle(document.documentElement).getPropertyValue(name).trim();
  const seriesColour = (i) => cssToken(`--series-${(i % 8) + 1}`);
  const toneColour = (tone) => (tone ? cssToken(`--${tone}`) : cssToken("--line-3"));
  const numberFmt = new Intl.NumberFormat(undefined, { maximumFractionDigits: 2 });
  const compactFmt = new Intl.NumberFormat(undefined, { notation: "compact", maximumFractionDigits: 1 });
  const fmtNum = (n, compact) => (n == null ? "–" : compact && Math.abs(n) >= 10000 ? compactFmt.format(n) : numberFmt.format(n));
  const withUnit = (n, unit) => (n == null ? "no value" : `${fmtNum(n)}${unit ? ` ${unit}` : ""}`);

  // Everything drawn to fit its width redraws when the window or the look changes.
  const redraws = new Set();
  const resized = typeof ResizeObserver === "function" ? new ResizeObserver((entries) => entries.forEach((e) => e.target.redraw?.())) : null;
  L.onChange(() => redraws.forEach((f) => f()));
  function fitted(el, draw) {
    el.redraw = draw;
    redraws.add(draw);
    resized?.observe(el);
    requestAnimationFrame(draw);
  }

  /** Round ticks from lo to hi, about `count` of them. */
  function ticksFor(lo, hi, count = 4) {
    if (lo === hi) { hi = lo + 1; if (lo > 0) lo = 0; }
    const rough = (hi - lo) / count;
    const mag = 10 ** Math.floor(Math.log10(rough));
    const step = [1, 2, 2.5, 5, 10].map((m) => m * mag).find((x) => x >= rough);
    const from = Math.floor(lo / step) * step;
    const to = Math.ceil(hi / step) * step;
    const ticks = [];
    for (let t = from; t <= to + step / 2; t += step) ticks.push(Math.round(t / step) * step);
    return { from, to, ticks };
  }

  /** A tooltip inside `host`, placed beside a point and kept within it. */
  function tooltip(host) {
    const tip = h("div", { class: "viz-tip", role: "status", hidden: true });
    host.append(tip);
    return {
      show(x, y, kids) {
        tip.replaceChildren(...kids);
        tip.hidden = false;
        const w = tip.offsetWidth;
        const room = host.clientWidth;
        tip.style.left = `${Math.max(4, Math.min(room - w - 4, x + 12 > room - w ? x - w - 12 : x + 12))}px`;
        tip.style.top = `${Math.max(4, y - tip.offsetHeight - 10)}px`;
      },
      hide() { tip.hidden = true; },
    };
  }
  const tipRow = (colour, name, value) => h("div", { class: "viz-tip-row" }, colour ? h("span", { class: "key", style: { background: colour } }) : null, h("span", { class: "grow" }, name), h("b", { class: "num" }, value));

  /** The chart's numbers as a table, which is how a reader without colour, or a screen reader, reads it. */
  const chartTable = (b) => ({ columns: [{ label: b.kind === "bar" || b.kind === "line" ? "Label" : "" }, ...b.series.map((s) => ({ label: s.name, align: "right" }))], rows: b.labels.map((l, i) => [l, ...b.series.map((s) => (s.values[i] == null ? "" : String(s.values[i])))]) });

  // --- chart ------------------------------------------------------------------------
  function chartBlock(b) {
    const plot = h("div", { class: "viz-plot", tabindex: "0", role: "img", "aria-label": chartSummary(b) });
    const tip = tooltip(plot);
    const legend = b.series.length > 1 ? h("div", { class: "viz-legend", "aria-hidden": "true" }, b.series.map((s, i) => h("span", { class: "viz-key" }, h("span", { class: `key ${b.kind}`, style: { background: seriesColour(i) } }), s.name))) : null;
    const t = chartTable(b);
    const numbers = h("div", { class: "viz-numbers", hidden: true }, tableBlock({ columns: t.columns, rows: t.rows, sort: true, filter: false, title: b.title }));
    const toggle = h("button", { class: "ghost", type: "button", "aria-expanded": "false", onclick: (e) => { numbers.hidden = !numbers.hidden; e.currentTarget.setAttribute("aria-expanded", String(!numbers.hidden)); e.currentTarget.textContent = numbers.hidden ? "Show the numbers" : "Hide the numbers"; } }, "Show the numbers");
    let focusAt = -1;
    const draw = () => {
      if (!plot.isConnected) return;
      legend?.querySelectorAll(".key").forEach((k, i) => { k.style.background = seriesColour(i); });
      const svg = b.kind === "line" ? lineChart(b, plot, tip, () => focusAt) : barChart(b, plot, tip);
      plot.querySelector("svg")?.remove();
      plot.prepend(svg);
      b.svg = svg;
    };
    // The keyboard walks the points, showing each one's values.
    plot.addEventListener("keydown", (e) => {
      if (e.key !== "ArrowLeft" && e.key !== "ArrowRight") return;
      e.preventDefault(); e.stopPropagation();
      focusAt = Math.max(0, Math.min(b.labels.length - 1, focusAt + (e.key === "ArrowRight" ? 1 : -1)));
      plot.showAt?.(focusAt);
    });
    plot.addEventListener("blur", () => { focusAt = -1; plot.hideAt?.(); });
    fitted(plot, draw);
    return h("div", { class: "viz" }, legend, plot, h("div", { class: "table-tools" }, h("span", { class: "muted small grow" }, b.unit ? `In ${b.unit}` : ""), toggle), numbers);
  }

  function chartSummary(b) {
    const all = b.series.flatMap((s) => s.values).filter((v) => v != null);
    const range = all.length ? `, from ${fmtNum(Math.min(...all))} to ${fmtNum(Math.max(...all))}${b.unit ? ` ${b.unit}` : ""}` : "";
    return `${b.kind === "line" ? "Line" : "Bar"} chart${b.title ? ` of ${b.title}` : ""}: ${b.series.map((s) => s.name).join(", ")} over ${b.labels.length} ${b.labels.length === 1 ? "label" : "labels"}${range}. Arrow keys read each point; Show the numbers gives the table.`;
  }

  /** The frame every chart shares: its size, the y scale, gridlines, and the labels along the bottom. */
  function chartFrame(b, plot, lo, hi, right) {
    const width = Math.max(260, plot.clientWidth || 600);
    const height = Math.round(Math.min(300, Math.max(200, width * 0.42)));
    const { from, to, ticks } = ticksFor(lo, hi);
    const compact = Math.max(Math.abs(from), Math.abs(to)) >= 10000;
    const tickText = ticks.map((t) => fmtNum(t, compact));
    const left = 10 + Math.max(...tickText.map((s) => s.length)) * 7;
    const m = { top: 14, right, bottom: 26, left };
    const iw = width - m.left - m.right;
    const ih = height - m.top - m.bottom;
    const y = (v) => m.top + ih - ((v - from) / (to - from)) * ih;
    const grid = cssToken("--line");
    const muted = cssToken("--muted");
    const svg = sv("svg", { width, height, viewBox: `0 0 ${width} ${height}`, class: "viz-svg", "font-family": cssToken("--font") || "system-ui", "font-size": 11 });
    svg.append(sv("rect", { x: 0, y: 0, width, height, fill: "none", class: "viz-bg" }));
    ticks.forEach((t, i) => {
      svg.append(sv("line", { x1: m.left, x2: width - m.right, y1: y(t), y2: y(t), stroke: t === 0 && from < 0 ? cssToken("--line-3") : grid, "stroke-width": 1, "shape-rendering": "crispEdges" }));
      svg.append(sv("text", { x: m.left - 8, y: y(t) + 4, "text-anchor": "end", fill: muted }, tickText[i]));
    });
    return { svg, width, height, m, iw, ih, y, from, to, muted };
  }

  /** Labels along the bottom, every nth so they never collide. */
  function bottomLabels(f, b, xAt) {
    const longest = Math.max(1, ...b.labels.map((l) => l.length));
    const slot = f.iw / Math.max(1, b.labels.length);
    const every = Math.max(1, Math.ceil((longest * 6.4 + 10) / slot));
    b.labels.forEach((l, i) => {
      if (i % every && i !== b.labels.length - 1) return;
      if (i === b.labels.length - 1 && i % every && slot * (i % every) < longest * 6.4) return;
      f.svg.append(sv("text", { x: xAt(i), y: f.height - 8, "text-anchor": "middle", fill: f.muted }, l));
    });
  }

  function barChart(b, plot, tip) {
    const n = b.labels.length;
    const k = b.series.length;
    const sums = b.labels.map((_, i) => b.series.reduce((a, s) => a + (s.values[i] ?? 0), 0));
    const all = b.stacked ? sums : b.series.flatMap((s) => s.values).filter((v) => v != null);
    const f = chartFrame(b, plot, Math.min(0, ...all), Math.max(0, ...all), 12);
    const band = f.iw / n;
    const barW = b.stacked || k === 1 ? Math.min(24, band * 0.6) : Math.min(24, (band * 0.72 - (k - 1) * 2) / k);
    const groupW = b.stacked || k === 1 ? barW : barW * k + (k - 1) * 2;
    const x0 = (i) => f.m.left + band * i + (band - groupW) / 2;
    const zero = f.y(Math.max(f.from, Math.min(f.to, 0)));
    // A bar with a 4px rounded data end and a square foot on the baseline.
    const bar = (x, yTop, yBottom, round) => {
      const h0 = Math.abs(yBottom - yTop);
      const r = Math.min(4, barW / 2, h0);
      const up = yTop < yBottom;
      if (!round || r <= 0) return `M${x},${yBottom}V${yTop}H${x + barW}V${yBottom}Z`;
      return up
        ? `M${x},${yBottom}V${yTop + r}Q${x},${yTop} ${x + r},${yTop}H${x + barW - r}Q${x + barW},${yTop} ${x + barW},${yTop + r}V${yBottom}Z`
        : `M${x},${yTop}V${yBottom - r}Q${x},${yBottom} ${x + r},${yBottom}H${x + barW - r}Q${x + barW},${yBottom} ${x + barW},${yBottom - r}V${yTop}Z`;
    };
    const marks = sv("g", { class: "viz-marks" });
    const hits = sv("g", { class: "viz-hits" });
    for (let i = 0; i < n; i++) {
      if (b.stacked) {
        let base = 0;
        const top = b.series.reduce((last, s, j) => (s.values[i] ? j : last), -1);
        b.series.forEach((s, j) => {
          const v = s.values[i];
          if (!v) return;
          const y1 = f.y(base + v);
          // A 2px gap in the panel's colour between segments, not a stroke around them.
          const y2 = f.y(base) - (base > 0 ? 2 : 0);
          marks.append(sv("path", { d: bar(x0(i), y1, Math.max(y1, y2), j === top), fill: seriesColour(j) }));
          base += v;
        });
      } else {
        b.series.forEach((s, j) => {
          const v = s.values[i];
          if (v == null) return;
          const x = x0(i) + j * (barW + 2);
          marks.append(sv("path", { d: v >= 0 ? bar(x, f.y(v), zero, v !== 0) : bar(x, zero, f.y(v), true), fill: seriesColour(j) }));
        });
      }
      // The whole column is the hover target, wider than the bar.
      const hit = sv("rect", { x: f.m.left + band * i, y: f.m.top, width: band, height: f.ih, fill: "transparent" });
      const show = () => {
        hits.querySelectorAll(".on").forEach((e) => e.classList.remove("on"));
        hit.classList.add("on");
        const rows = b.series.map((s, j) => tipRow(seriesColour(j), s.name, withUnit(s.values[i], b.unit)));
        if (b.stacked && k > 1) rows.push(tipRow("", "Total", withUnit(sums[i], b.unit)));
        tip.show(x0(i) + groupW / 2, f.y(b.stacked ? sums[i] : Math.max(0, ...b.series.map((s) => s.values[i] ?? 0))), [h("div", { class: "viz-tip-h" }, b.labels[i]), ...rows]);
      };
      hit.addEventListener("pointerenter", show);
      hit.addEventListener("pointerleave", () => { hit.classList.remove("on"); tip.hide(); });
      hit.show = show;
      hits.append(hit);
    }
    f.svg.append(hits, marks);
    // A value at the tip of each bar when one series fits; otherwise the axis and the tooltip carry them.
    if (k === 1 && !b.stacked && band >= 34) {
      b.series[0].values.forEach((v, i) => {
        if (v == null) return;
        f.svg.append(sv("text", { x: x0(i) + barW / 2, y: v >= 0 ? f.y(v) - 5 : f.y(v) + 13, "text-anchor": "middle", fill: cssToken("--text-2"), class: "num" }, fmtNum(v, true)));
      });
    }
    bottomLabels(f, b, (i) => x0(i) + groupW / 2);
    plot.showAt = (i) => hits.children[i]?.show();
    plot.hideAt = () => tip.hide();
    return f.svg;
  }

  function lineChart(b, plot, tip, focused) {
    const n = b.labels.length;
    const k = b.series.length;
    const all = b.series.flatMap((s) => s.values).filter((v) => v != null);
    const ends = b.series.map((s) => [...s.values].reverse().find((v) => v != null));
    // Names at the line ends, when the lines end apart; else the legend and tooltip carry them.
    const named = k <= 4;
    const right = 12 + (named ? Math.min(110, Math.max(...b.series.map((s, i) => (k === 1 ? fmtNum(ends[i]).length : s.name.length))) * 6.6 + 10) : 0);
    const lo = Math.min(...all);
    const hi = Math.max(...all);
    const pad = (hi - lo) * 0.08 || 1;
    const f = chartFrame(b, plot, lo >= 0 && lo - pad < 0 ? 0 : lo - pad, hi + pad, right);
    const x = (i) => (n === 1 ? f.m.left + f.iw / 2 : f.m.left + (i * f.iw) / (n - 1));
    const surface = cssToken("--panel");
    const marks = sv("g");
    b.series.forEach((s, j) => {
      let d = "";
      s.values.forEach((v, i) => { if (v == null) return; d += `${d && s.values[i - 1] != null ? "L" : "M"}${x(i).toFixed(1)},${f.y(v).toFixed(1)}`; });
      if (k === 1) {
        // One series gets a faint wash under its line.
        const first = s.values.findIndex((v) => v != null);
        const last = s.values.length - 1 - [...s.values].reverse().findIndex((v) => v != null);
        if (first >= 0 && s.values.every((v, i) => i < first || i > last || v != null)) marks.append(sv("path", { d: `${d}L${x(last)},${f.y(Math.max(f.from, 0))}L${x(first)},${f.y(Math.max(f.from, 0))}Z`, fill: seriesColour(j), "fill-opacity": 0.1 }));
      }
      marks.append(sv("path", { d, fill: "none", stroke: seriesColour(j), "stroke-width": 2, "stroke-linejoin": "round", "stroke-linecap": "round" }));
      const lastI = s.values.length - 1 - [...s.values].reverse().findIndex((v) => v != null);
      if (lastI < s.values.length) marks.append(sv("circle", { cx: x(lastI), cy: f.y(s.values[lastI]), r: 4, fill: seriesColour(j), stroke: surface, "stroke-width": 2 }));
    });
    if (named) {
      const placed = [];
      b.series.forEach((s, j) => {
        const lastI = s.values.length - 1 - [...s.values].reverse().findIndex((v) => v != null);
        const yy = f.y(s.values[lastI]);
        // Labels that would collide are left to the legend, not nudged off their lines.
        if (placed.some((p) => Math.abs(p - yy) < 13)) return;
        placed.push(yy);
        marks.append(sv("text", { x: x(lastI) + 9, y: yy + 4, fill: cssToken("--text-2") }, k === 1 ? fmtNum(s.values[lastI], true) : s.name));
      });
    }
    // The crosshair: the nearest label's values for every series.
    const cross = sv("g", { class: "viz-cross", visibility: "hidden" }, sv("line", { y1: f.m.top, y2: f.m.top + f.ih, stroke: cssToken("--line-3"), "stroke-width": 1 }), b.series.map((s, j) => sv("circle", { r: 4, fill: seriesColour(j), stroke: surface, "stroke-width": 2 })));
    const show = (i) => {
      cross.setAttribute("visibility", "visible");
      cross.firstChild.setAttribute("x1", x(i)); cross.firstChild.setAttribute("x2", x(i));
      b.series.forEach((s, j) => {
        const c = cross.children[j + 1];
        const v = s.values[i];
        c.setAttribute("visibility", v == null ? "hidden" : "visible");
        if (v != null) { c.setAttribute("cx", x(i)); c.setAttribute("cy", f.y(v)); }
      });
      const top = Math.min(...b.series.map((s) => (s.values[i] == null ? f.m.top + f.ih : f.y(s.values[i]))));
      tip.show(x(i), top, [h("div", { class: "viz-tip-h" }, b.labels[i]), ...b.series.map((s, j) => tipRow(k > 1 ? seriesColour(j) : "", s.name, withUnit(s.values[i], b.unit)))]);
    };
    const hide = () => { cross.setAttribute("visibility", "hidden"); tip.hide(); };
    const overlay = sv("rect", { x: f.m.left - 6, y: f.m.top, width: f.iw + 12, height: f.ih, fill: "transparent" });
    overlay.addEventListener("pointermove", (e) => {
      const r = f.svg.getBoundingClientRect();
      const px = e.clientX - r.left;
      show(n === 1 ? 0 : Math.max(0, Math.min(n - 1, Math.round(((px - f.m.left) / f.iw) * (n - 1)))));
    });
    overlay.addEventListener("pointerleave", hide);
    f.svg.append(marks, cross, overlay);
    bottomLabels(f, b, x);
    plot.showAt = show;
    plot.hideAt = hide;
    if (focused() >= 0) requestAnimationFrame(() => show(focused()));
    return f.svg;
  }

  /** A stats tile's trend: a small line, its last point marked. */
  function sparkline(values, label) {
    const w = 120;
    const ht = 28;
    const el = h("div", { class: "spark", role: "img", "aria-label": `${label}: from ${fmtNum(values[0])} to ${fmtNum(values.at(-1))}, ${values.length} points` });
    const draw = () => {
      const lo = Math.min(...values);
      const hi = Math.max(...values);
      const x = (i) => 4 + (values.length === 1 ? (w - 8) / 2 : (i * (w - 8)) / (values.length - 1));
      const y = (v) => 4 + (hi === lo ? (ht - 8) / 2 : (1 - (v - lo) / (hi - lo)) * (ht - 8));
      const colour = seriesColour(0);
      el.replaceChildren(sv("svg", { width: w, height: ht, viewBox: `0 0 ${w} ${ht}`, "aria-hidden": "true" },
        sv("path", { d: values.map((v, i) => `${i ? "L" : "M"}${x(i).toFixed(1)},${y(v).toFixed(1)}`).join(""), fill: "none", stroke: colour, "stroke-width": 2, "stroke-linejoin": "round", "stroke-linecap": "round" }),
        sv("circle", { cx: x(values.length - 1), cy: y(values.at(-1)), r: 3, fill: colour, stroke: cssToken("--panel"), "stroke-width": 1.5 })));
    };
    redraws.add(draw);
    draw();
    return el;
  }

  // --- diagram ----------------------------------------------------------------------
  const BOX = { w: 168, h: 52, gapX: 64, gapY: 22, pad: 16 };
  let diagrams = 0;
  /** A label in at most two lines of about 22 characters, the rest left to its tooltip. */
  function twoLines(text, max = 22) {
    const words = String(text).split(/\s+/);
    const lines = [""];
    for (const w of words) {
      const next = lines.at(-1) ? `${lines.at(-1)} ${w}` : w;
      if (next.length <= max || !lines.at(-1)) lines[lines.length - 1] = next;
      else if (lines.length < 2) lines.push(w);
      else { lines[1] = `${lines[1]}…`; break; }
    }
    return lines.map((l) => (l.length > max + 1 ? `${l.slice(0, max)}…` : l));
  }
  function diagramBlock(b) {
    b.marker = `arrow-${++diagrams}`;
    const host = h("div", { class: "viz-diagram", tabindex: "0", role: "img", "aria-label": diagramSummary(b) });
    const draw = () => {
      const svg = diagramSvg(b);
      // Shrunk to fit while the words stay readable, to 70%; past that it scrolls.
      const natural = Number(svg.getAttribute("width"));
      const room = host.clientWidth;
      const scale = room && natural > room ? Math.max(0.7, room / natural) : 1;
      if (scale < 1) { svg.setAttribute("width", Math.round(natural * scale)); svg.setAttribute("height", Math.round(Number(svg.getAttribute("height")) * scale)); }
      host.replaceChildren(svg);
      b.svg = svg;
    };
    fitted(host, draw);
    return h("div", { class: "viz" }, host);
  }
  function diagramSummary(b) {
    const name = new Map(b.nodes.map((n) => [n.id, n.label]));
    return `Diagram${b.title ? ` of ${b.title}` : ""}: ${b.nodes.length} boxes. ${b.links.map((l) => `${name.get(l.from)} to ${name.get(l.to)}${l.label ? ` (${l.label})` : ""}`).join("; ")}.`;
  }
  function diagramSvg(b) {
    const across = b.direction === "right";
    const counts = {};
    for (const n of b.nodes) counts[n.rank] = Math.max(counts[n.rank] ?? 0, n.order + 1);
    const ranks = Math.max(...b.nodes.map((n) => n.rank)) + 1;
    const most = Math.max(...Object.values(counts));
    const stepR = across ? BOX.w + BOX.gapX : BOX.h + BOX.gapY + 18;
    const stepO = across ? BOX.h + BOX.gapY : BOX.w + BOX.gapY;
    const at = new Map(b.nodes.map((n) => {
      const offset = ((most - counts[n.rank]) * stepO) / 2;
      const r = BOX.pad + n.rank * stepR;
      const o = BOX.pad + offset + n.order * stepO;
      return [n.id, across ? { x: r, y: o } : { x: o, y: r }];
    }));
    const width = across ? BOX.pad * 2 + (ranks - 1) * stepR + BOX.w : BOX.pad * 2 + (most - 1) * stepO + BOX.w;
    const height = across ? BOX.pad * 2 + (most - 1) * stepO + BOX.h + 24 : BOX.pad * 2 + (ranks - 1) * stepR + BOX.h + 24;
    const ink = cssToken("--text");
    const muted = cssToken("--muted");
    const panel = cssToken("--panel");
    const line = cssToken("--line-3");
    const svg = sv("svg", { width, height, viewBox: `0 0 ${width} ${height}`, class: "viz-svg", "font-family": cssToken("--font") || "system-ui", "font-size": 12 },
      sv("defs", null, sv("marker", { id: b.marker, viewBox: "0 0 10 10", refX: 9, refY: 5, markerWidth: 7, markerHeight: 7, orient: "auto-start-reverse" }, sv("path", { d: "M0,0L10,5L0,10z", fill: muted }))));
    const arrowId = `url(#${b.marker})`;
    const edges = sv("g");
    const labels = sv("g");
    const linkEls = [];
    for (const l of b.links) {
      const a = at.get(l.from);
      const z = at.get(l.to);
      let d;
      let mid;
      if (l.from === l.to) {
        d = `M${a.x + BOX.w - 24},${a.y}c0,-26 30,-26 30,0`;
        mid = { x: a.x + BOX.w - 9, y: a.y - 22 };
      } else if (across) {
        const forward = !l.back && z.x > a.x;
        const sx = forward ? a.x + BOX.w : a.x + BOX.w / 2;
        const sy = forward ? a.y + BOX.h / 2 : a.y + BOX.h;
        const ex = forward ? z.x : z.x + BOX.w / 2;
        const ey = forward ? z.y + BOX.h / 2 : z.y + BOX.h;
        const dip = Math.max(sy, ey) + 26;
        d = forward ? `M${sx},${sy}C${sx + BOX.gapX / 2},${sy} ${ex - BOX.gapX / 2},${ey} ${ex},${ey}` : `M${sx},${sy}C${sx},${dip} ${ex},${dip} ${ex},${ey + 2}`;
        mid = forward ? { x: (sx + ex) / 2, y: (sy + ey) / 2 } : { x: (sx + ex) / 2, y: dip - 6 };
      } else {
        const forward = !l.back && z.y > a.y;
        const sx = forward ? a.x + BOX.w / 2 : a.x + BOX.w;
        const sy = forward ? a.y + BOX.h : a.y + BOX.h / 2;
        const ex = forward ? z.x + BOX.w / 2 : z.x + BOX.w;
        const ey = forward ? z.y : z.y + BOX.h / 2;
        const out = Math.max(sx, ex) + 30;
        d = forward ? `M${sx},${sy}C${sx},${sy + 24} ${ex},${ey - 24} ${ex},${ey}` : `M${sx},${sy}C${out},${sy} ${out},${ey} ${ex + 2},${ey}`;
        mid = forward ? { x: (sx + ex) / 2, y: (sy + ey) / 2 } : { x: out - 8, y: (sy + ey) / 2 };
      }
      const path = sv("path", { d, fill: "none", stroke: line, "stroke-width": 1.5, "marker-end": arrowId, "stroke-dasharray": l.back ? "4 3" : null });
      edges.append(path);
      linkEls.push({ l, path });
      if (l.label) {
        const t = sv("text", { x: mid.x, y: mid.y + 4, "text-anchor": "middle", fill: muted, "font-size": 11, "paint-order": "stroke", stroke: panel, "stroke-width": 4 }, l.label);
        labels.append(t);
      }
    }
    const boxes = sv("g");
    for (const n of b.nodes) {
      const p = at.get(n.id);
      const lines = twoLines(n.label);
      const g = sv("g", { class: "viz-node", tabindex: "-1" },
        sv("title", null, n.note ? `${n.label}: ${n.note}` : n.label),
        sv("rect", { x: p.x, y: p.y, width: BOX.w, height: BOX.h, rx: 8, fill: panel, stroke: n.tone ? toneColour(n.tone) : line, "stroke-width": n.tone ? 2 : 1 }),
        lines.map((t, i) => sv("text", { x: p.x + BOX.w / 2, y: p.y + BOX.h / 2 + 4 + (i - (lines.length - 1) / 2) * 15, "text-anchor": "middle", fill: ink, "font-weight": 500 }, t)));
      // Hovering a box brings out its arrows.
      g.addEventListener("pointerenter", () => linkEls.forEach(({ l, path }) => path.setAttribute("stroke", l.from === n.id || l.to === n.id ? cssToken("--accent") : line)));
      g.addEventListener("pointerleave", () => linkEls.forEach(({ path }) => path.setAttribute("stroke", line)));
      boxes.append(g);
    }
    svg.append(edges, boxes, labels);
    return svg;
  }
  /** The diagram as Mermaid, which Markdown viewers draw. */
  function mermaid(b) {
    const q = (s) => `"${String(s).replace(/"/g, "#quot;")}"`;
    const id = (s) => `n_${String(s).replace(/[^A-Za-z0-9_]/g, "_")}`;
    return [`flowchart ${b.direction === "down" ? "TD" : "LR"}`, ...b.nodes.map((n) => `  ${id(n.id)}[${q(n.label)}]`), ...b.links.map((l) => `  ${id(l.from)} -->${l.label ? `|${q(l.label)}|` : ""} ${id(l.to)}`)].join("\n") + "\n";
  }

  // --- timeline ---------------------------------------------------------------------
  const STATE_MARK = { done: "✓", now: "●", next: "○", "": "·" };
  const STATE_WORD = { done: "Done", now: "Now", next: "Next", "": "" };
  function timelineBlock(b) {
    return h("ol", { class: "timeline" }, b.events.map((e) => h("li", { class: `tl-${e.state || "plain"}` },
      h("span", { class: "tl-mark", "aria-hidden": "true" }, STATE_MARK[e.state]),
      h("div", { class: "tl-body" },
        h("div", { class: "tl-head" }, e.date ? h("span", { class: "tl-date num" }, e.date) : null, h("b", null, e.title), e.state ? h("span", { class: "chip" }, STATE_WORD[e.state]) : null),
        e.note ? h("div", { class: "muted desc-sm" }, e.note) : null))));
  }
  const timelineMd = (b) => b.events.map((e) => `- ${e.state === "done" ? "[x]" : "[ ]"} ${e.date ? `${e.date}: ` : ""}**${e.title}**${e.state && e.state !== "done" ? ` (${e.state})` : ""}${e.note ? `. ${e.note}` : ""}`).join("\n") + "\n";

  // --- board ------------------------------------------------------------------------
  function boardBlock(b) {
    return h("div", { class: "board", style: { "--n": b.lanes.length } }, b.lanes.map((lane) => {
      const cards = b.cards.filter((c) => c.column === lane.id);
      return h("section", { class: "board-lane", "aria-label": `${lane.title}, ${cards.length} ${cards.length === 1 ? "card" : "cards"}` },
        h("div", { class: "lane-head" }, h("b", null, lane.title), h("span", { class: "muted small num" }, cards.length)),
        cards.length ? cards.map((c) => h("article", { class: `board-card ${c.tone ? `tone-${c.tone}` : ""}` },
          h("div", { class: "card-label" }, c.title),
          c.note ? h("div", { class: "muted desc-sm" }, c.note) : null,
          c.tags.length || c.owner ? h("div", { class: "card-meta" }, c.tags.map((t) => h("span", { class: "chip" }, t)), c.owner ? h("span", { class: "muted small grow right" }, c.owner) : null) : null)) : h("p", { class: "muted small" }, "Nothing here."));
    }));
  }
  const boardMd = (b) => b.lanes.map((lane) => [`## ${lane.title}`, "", ...(b.cards.filter((c) => c.column === lane.id).map((c) => `- **${c.title}**${c.note ? `: ${c.note}` : ""}${c.tags.length ? ` [${c.tags.join(", ")}]` : ""}${c.owner ? ` (${c.owner})` : ""}`)), ""].join("\n")).join("\n");
  const boardRows = (b) => b.cards.map((c) => [b.lanes.find((l) => l.id === c.column)?.title ?? c.column, c.title, c.note, c.owner, c.tags.join("; ")]);

  /** An SVG as a file of its own, its colours already in it. */
  function svgText(svg) {
    const copy = svg.cloneNode(true);
    copy.setAttribute("xmlns", SVG_NS);
    // The file is drawn at its own size, not the size it was shrunk to on the page.
    const [, , vw, vh] = (copy.getAttribute("viewBox") ?? "").split(" ").map(Number);
    if (vw && vh) { copy.setAttribute("width", vw); copy.setAttribute("height", vh); }
    copy.querySelectorAll(".viz-hits, .viz-cross").forEach((e) => e.remove());
    copy.querySelector(".viz-bg")?.setAttribute("fill", cssToken("--panel"));
    if (!copy.querySelector(".viz-bg")) copy.prepend(sv("rect", { width: "100%", height: "100%", fill: cssToken("--panel") }));
    return `<?xml version="1.0" encoding="UTF-8"?>\n${new XMLSerializer().serializeToString(copy)}\n`;
  }
