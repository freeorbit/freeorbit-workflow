// The kit's side of `wf ask wait` on a team server, and which pages go to
// one: lib/ask/index.mjs calls these when the project's config names a team
// server and the page does not stay on this machine. The design is
// docs/design/team-server.md.

import { mkdirSync } from "node:fs";
import { join } from "node:path";

import { answersMarkdown } from "../ask/answers.mjs";
import { keepRound } from "../ask/live.mjs";
import { withOptions } from "../ask/more.mjs";
import { readAnswers } from "../ask/page.mjs";
import { answersPath, askDir } from "../ask/store.mjs";
import { writeWhole } from "../files.mjs";
import { sleep } from "../process.mjs";
import { markWaiting as markTeamWaiting, pageState, teamFor, tellTold, Unreachable } from "./client.mjs";

/**
 * A page's team server, or null when the project names none or the page
 * stays on this machine: its spec's `local`, from `wf ask page --local` or
 * the spec itself. The one rule every ask command uses.
 */
export const teamOf = (c, spec) => (spec?.local === true ? null : teamFor(c.config, process.env, c.root));

/**
 * `wf ask wait` on a team server: the same as here, from the server's state.
 * The page is marked as waited on there, renewed while this runs; answers
 * are kept here too, so answers, record, and history read them as ever.
 */
export async function waitTeam(c, team, spec, timeout, log, asksSaid) {
  const id = spec.id;
  const start = Date.now();
  const since = new Date().toISOString();
  let seen = null;
  let s = null;
  let misses = 0;
  try {
    await markTeamWaiting(team, id, true, since);
    for (;;) {
      // A blip in the connection is tried again, slower each time, for about two minutes; a no from the server is not.
      let got;
      try {
        got = await pageState(team, id, { since: seen, waiting: true });
        misses = 0;
      } catch (err) {
        if (!(err instanceof Unreachable) || ++misses > 8) throw err;
        await sleep(Math.min(30_000, 1000 * 2 ** misses));
        continue;
      }
      if (!got.unchanged) {
        s = got;
        seen = got.version;
      }
      if (s.hash !== spec.hash) {
        log(`The page ${id} on the team server is another one (${s.hash}, here ${spec.hash}); build it again with npx wf ask page, which publishes it.`);
        return 1;
      }
      if (s.state === "status") {
        log(`${id} is a status page; it has no questions to wait for.`);
        return 0;
      }
      const asked = withOptions(spec, s.more?.replies);
      if (s.state !== "waiting") {
        keepTeamCopy(c, spec, s);
        log(answersMarkdown(asked, s.answers, s.replies, { brief: true }).trimEnd());
        if (s.untold.length) {
          await tellTold(team, id, s.untold);
          log(`\n${asksSaid(asked, s.untold, "More asked too, while the person answered:")}`);
        }
        return 0;
      }
      if (s.untold.length) {
        await tellTold(team, id, s.untold);
        log(asksSaid(asked, s.untold, `More asked on the page ${id}, while the person answers:`));
        return 0;
      }
      if (timeout && Date.now() - start > timeout) {
        log(`No answers to ${id} after ${timeout / 1000} s.`);
        return 3;
      }
      await sleep(timeout && timeout < 10_000 ? 250 : 2000);
    }
  } finally {
    await markTeamWaiting(team, id, false).catch(() => {});
  }
}

/**
 * Keep the team server's answers here, with the agent's replies and more
 * that go with them, so answers, record, history, and export read what the
 * person saw. Answers last, so they are newer than the replies. A round is
 * kept once for each send.
 */
function keepTeamCopy(c, spec, s) {
  const id = spec.id;
  mkdirSync(join(c.view, "answers"), { recursive: true, mode: 0o700 });
  writeWhole(join(askDir(c.view, id), "replies.json"), `${JSON.stringify(s.replies ?? {}, null, 2)}\n`);
  writeWhole(join(askDir(c.view, id), "more.json"), `${JSON.stringify({ replies: s.more?.replies ?? {}, told: s.more?.told ?? {} }, null, 2)}\n`);
  const before = readAnswers(c.view, id);
  writeWhole(answersPath(c.view, id), `${JSON.stringify(s.answers, null, 2)}\n`);
  if (before?.submitted !== s.answers.submitted || before?.hash !== s.answers.hash) keepRound(c.view, withOptions(spec, s.more?.replies), s.answers);
}
