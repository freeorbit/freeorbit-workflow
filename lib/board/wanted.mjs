// What the board should hold, from the repo: each story's values and its
// acceptance comment, and the client's open questions. index.mjs plans and
// writes the difference.

import { escapeHtml } from "../html.mjs";
import { projectStories } from "../docs/stories.mjs";
import { statusOf, storiesDone, storyRows } from "./status.mjs";
import { chunkPrs, repoUrl, storyPr } from "./prs.mjs";
import { HEADING, MARK, pinnedNote } from "./voice.mjs";
import { laneOf } from "../lanes.mjs";
import { CLIENT, questionRows } from "../logs/questions.mjs";
import { storyIds } from "../docs/shape.mjs";

const capital = (text) => text.charAt(0).toUpperCase() + text.slice(1);
/** An area's name as its groups on the board show it: App, from the area id app. */
export const areaName = (areaId) => capital(String(areaId ?? ""));
/** Inline Markdown a story uses, as HTML: code and bold. */
const inline = (text) =>
  escapeHtml(text)
    .replace(/`([^`]+)`/g, "<code>$1</code>")
    .replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>");
/** Text with markup, bullets, and spacing gone, so two renderings of one comment compare equal. */
export const flat = (text) =>
  String(text ?? "")
    .replace(/<[^>]+>/g, "")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&nbsp;/g, " ")
    .replace(/[`*•\s ]/g, "")
    .replace(/[’‘]/g, "'");

/** An HTML text's tags in order, without attributes, so a change of layout with the same words still shows. */
export const tags = (html) => [...String(html ?? "").matchAll(/<\/?([a-z0-9]+)/gi)].map((match) => match[0].toLowerCase()).join("");

/** The pinned comment's HTML for a story. */
export function commentHtml(story, botName = "Orbit") {
  // A line taken out keeps its place in the story so no ID moves; the client is shown only what is promised.
  const items = story.acceptance.filter((line) => !line.removed).map((line) => `<li>${inline(line.text)}${line.sub.length ? `<ul>${line.sub.map((sub) => `<li>${inline(sub)}</li>`).join("")}</ul>` : ""}</li>`).join("");
  return `<blockquote><p>${MARK} ${escapeHtml(pinnedNote(botName))}</p></blockquote><p><strong>${HEADING}</strong></p><p>${inline(story.as)}</p>${items ? `<ul>${items}</ul>` : ""}`;
}

/** The open questions the client answers, each { id, question, stories }; a Story of none names no story. */
export function clientQuestions({ config, tracked, files }) {
  if (!tracked.includes(config.logs.openQuestions)) return [];
  const prefixes = config.areas.map((area) => area.prefix).filter(Boolean);
  return questionRows(files(config.logs.openQuestions))
    .filter((row) => row.needs === CLIENT && /^Q-\d{3}$/.test(row.id))
    .map((row) => ({ id: row.id, question: row.question, stories: [...storyIds(row.story, prefixes)] }));
}

/** What the board should hold for each live story: { id, name, group, values, comment, story }. */
export function wanted(context, { git = () => "", env = {} } = {}) {
  const { config, tracked, files } = context;
  const present = new Set(tracked);
  const read = (path) => (present.has(path) ? files(path) : "");
  const order = read(config.buildOrder.file);
  const rows = storyRows(config, order, read(config.buildOrder.done));
  const doneChunks = [...new Set([...rows.values()].flat().filter((lane) => lane.state === "done").map((lane) => lane.chunk))];
  const prs = chunkPrs(git, config.buildOrder.done, doneChunks);
  const repo = prs.size ? repoUrl(git, env) : null;
  return projectStories(context).map((story) => {
    const area = areaName(story.area?.id ?? story.id.split("-")[0].toLowerCase());
    const lanes = rows.get(story.id) ?? [];
    const status = statusOf(storiesDone(order, story.area?.id), lanes);
    const pr = repo ? storyPr(lanes, prs) : null;
    // A built story's delivery: each done chunk, lanes taken as their chunk, with its For the client sentences.
    const delivery = [];
    for (const lane of status === "done" ? lanes.filter((each) => each.state === "done") : []) {
      const chunk = laneOf(lane.chunk)?.base ?? lane.chunk;
      let entry = delivery.find((each) => each.chunk === chunk);
      if (!entry) delivery.push((entry = { chunk, lines: [] }));
      if (lane.forClient && !entry.lines.includes(lane.forClient)) entry.lines.push(lane.forClient);
    }
    return {
      id: story.id,
      removed: story.removed,
      name: `${story.id} · ${story.title}`,
      group: story.group ? `${area} · ${story.group}` : area,
      values: { storyId: story.id, area: story.area?.id ?? "", status: config.board.statuses[status], chunk: lanes.map((lane) => lane.chunk).join(", "), story: story.as },
      comment: commentHtml(story, config.board.bot.name),
      // The pull request of the lane finished last, or null; sync never clears a link it cannot work out.
      pr: pr ? { url: `${repo}/pull/${pr.number}`, text: `#${pr.number}` } : null,
      delivery,
      story,
    };
  });
}
