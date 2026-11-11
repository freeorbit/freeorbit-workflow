// `wf try`: open the project's app for a person, at a test-data scenario,
// in a throwaway data folder, so their real data is never touched.
//
//   wf try                         pick a scenario (arrows, type to filter), then answer the project's questions
//   wf try <set>                   that set's scenarios, such as one plugin's
//   wf try <scenario> [--<flag> value ...]   that scenario, the questions answered by flags; --no-<flag> for no
//   wf try <scenario> --keep       reopen last time's folder, as it was left
//   wf try --dry-run ...           ask, then only say what it would do
//   wf try --files                 the project's test files, and where they are
//
// The kit owns the picker, the folder (<app.try.home>/<scenario>), and the
// commands it prints to repeat a run. The project's hooks module (`app.hooks`)
// says what there is to try and builds it:
//
//   export async function scenarios(ctx)         -> [{ id, about, set?, setName?, group?, note? }]
//   export async function asks(scenario, answers, ctx) -> the next question, or null
//        { flag, question, choices?: [{ id, about }], yesNo?, default?, other?, skip? }
//   export async function plan(scenario, answers, ctx) -> ["a step to run by hand", ...]
//   export async function files(ctx)             -> text
//   export async function prepare(ctx)           -> { env?, state?, note?, message? }   as for wf app
//   export async function stop(ctx)              after the app closes
//
// ctx is wf app's, with the loaded config, purpose "try", scenario, answers,
// keep, and state: an object prepare fills as it starts things, so stop knows
// what to undo even when prepare fails part way. stop gets it, with whatever
// state prepare returned merged in. How the app opens comes from `app.kind`: the
// project's dev command for tauri, its servers and a browser window for web
// (open.mjs).

import { existsSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join, resolve } from "node:path";
import { createInterface } from "node:readline/promises";
import { pathToFileURL } from "node:url";

import { appSettings, hookContext } from "../app/appsettings.mjs";
import { quote } from "../process.mjs";
import { openApp, openSteps } from "./open.mjs";
import { groupBy, pick } from "./picker.mjs";

const OWN = new Set(["--keep", "--dry-run", "--files"]);
const SAFE = /^[A-Za-z0-9][A-Za-z0-9._-]*$/;

/** The scenario or set named, and every other flag as an answer: `--x value`, `--x` alone for yes, `--no-x` for no. */
export function parseArgs(args) {
  const answers = {};
  let name = null;
  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (OWN.has(arg)) continue;
    if (arg.startsWith("--no-")) answers[arg.slice(5)] = false;
    else if (arg.startsWith("--")) {
      const next = args[i + 1];
      if (next !== undefined && !next.startsWith("--")) {
        answers[arg.slice(2)] = next;
        i += 1;
      } else answers[arg.slice(2)] = true;
    } else if (name === null) name = arg;
    else throw new Error(`one scenario at a time: ${name} or ${arg}`);
  }
  return { name, answers, keep: args.includes("--keep"), dryRun: args.includes("--dry-run"), files: args.includes("--files") };
}

/** The command that opens the same run again, with no questions: a no or a skip as --no-<flag>. */
export function againCommand(id, answers) {
  const flags = Object.entries(answers).flatMap(([flag, value]) => (value === null || value === false ? [`--no-${flag}`] : value === true ? [`--${flag}`] : [`--${flag}`, quote(String(value))]));
  return ["npx wf try", id, ...flags].join(" ");
}

/** Where a scenario's throwaway folder is: under app.try.home, from the project root, and never a folder that holds anything else of the person's. */
export function tryHome(config, id, root) {
  if (!SAFE.test(id)) throw new Error(`a scenario name is letters, digits, dots, dashes, and underscores, not ${JSON.stringify(id)}`);
  const set = config.app.try.home;
  const base = set ? resolve(root, set.replace(/^~(?=\/|$)/, homedir())) : join(homedir(), ".cache", `${config.app.name}-try`);
  if ([resolve("/"), resolve(homedir()), resolve(root)].includes(base)) throw new Error(`app.try.home is ${set}, which holds more than throwaway folders; set it to a folder of its own`);
  return join(base, id);
}

// A build that finished leaves this in the folder, so --keep never reopens a half-built one.
const BUILT = ".wf-try-built";

/** Ask one of the project's questions in the terminal. */
async function askLine(rl, ask) {
  if (ask.yesNo) {
    const def = ask.default ? "y" : "n";
    const answer = ((await rl.question(`${ask.question} (${def === "y" ? "Y/n" : "y/N"}) `)).trim().toLowerCase() || def).startsWith("y");
    return answer;
  }
  console.log(`\n${ask.question}\n`);
  const choices = ask.choices ?? [];
  choices.forEach((choice, i) => console.log(`  ${String(i + 1).padStart(2)}. ${choice.id.padEnd(28)} ${choice.about ?? ""}`));
  const or = [choices.length ? "Number or name" : null, ask.other ? ask.other : null].filter(Boolean).join(", or ");
  const typed = (await rl.question(`\n${or}, or Enter to ${ask.skip ?? "skip"}: `)).trim();
  if (!typed) return ask.default ?? null;
  const n = Number(typed);
  if (Number.isInteger(n) && n >= 1 && n <= choices.length) return choices[n - 1].id;
  if (choices.some((choice) => choice.id === typed) || ask.other) return typed;
  throw new Error(`no choice ${typed}`);
}

/** The real terminal, hooks, and launcher; tests pass their own. */
async function defaultIo(root, config) {
  const hooks = config.app.hooks ? await import(pathToFileURL(join(root, config.app.hooks)).href) : {};
  let rl = null;
  return {
    hooks,
    interactive: Boolean(process.stdin.isTTY && process.stdout.isTTY),
    pick,
    ask: async (question) => {
      rl ??= createInterface({ input: process.stdin, output: process.stdout });
      return askLine(rl, question);
    },
    done: () => rl?.close(),
    open: openApp,
    log: (line) => console.log(line),
  };
}

/** `wf try ...`; resolves to the exit code. Tests pass their own io: hooks, picker, questions, launcher, and log. */
export async function runTry(root, config, args, given) {
  const io = given ?? (await defaultIo(root, config));
  try {
    return await tryOnce(root, config, args, io);
  } catch (error) {
    io.log(`error: ${error.message}`);
    return 1;
  } finally {
    io.done?.();
  }
}

/** One wf try: pick the scenario, ask the project's questions, print the plan, then build the folder and open the app. */
async function tryOnce(root, config, args, io) {
  const { hooks, log } = io;
  if (!hooks.scenarios || !hooks.prepare) throw new Error("wf try needs scenarios(ctx) and prepare(ctx) in the project's hooks module, app.hooks; see the kit's app-testing skill");
  const opts = parseArgs(args);
  const s = appSettings(root, config);
  // A Tauri app finds its data through XDG_DATA_HOME only on Linux; elsewhere it would open the person's real data.
  if (!s.web && (io.platform ?? process.platform) !== "linux") throw new Error("wf try opens a Tauri app on Linux only: elsewhere the app would not use the throwaway folder, and would open your real data");
  // One person opens one app, so the instance is 0 and there is no second instance to lock against.
  const base = { ...hookContext(s, { instance: 0, lockSeenData: async () => () => {}, env: process.env, purpose: "try" }), config };
  if (opts.files) {
    log(hooks.files ? String(await hooks.files(base)).trimEnd() : "The project's hooks list no test files (files(ctx) in app.hooks).");
    return 0;
  }

  const all = await hooks.scenarios(base);
  const sets = [...new Map(all.filter((one) => one.set).map((one) => [one.set, { id: one.set, name: one.setName ?? one.set }])).values()];
  let chosen = all.find((one) => one.id === opts.name) ?? null;
  let set = chosen?.set ?? sets.find((one) => one.id === opts.name)?.id ?? null;
  if (opts.name && !chosen && !set) throw new Error(`no scenario or set called ${opts.name}; run wf try to see them`);
  const row = (one) => `${one.id.padEnd(34)} ${one.note ? `[${one.note}] ` : ""}${one.about ?? ""}`;
  const groupsIn = (id) => groupBy(all.filter((one) => !id || one.set === id), "group");

  if (!chosen) {
    if (!io.interactive) {
      for (const each of sets.length ? sets.filter((one) => !set || one.id === set) : [{ id: null, name: null }]) {
        if (each.name) log(`\n${each.name} (wf try ${each.id})`);
        for (const group of groupsIn(each.id)) {
          log(`\n  ${group.name}`);
          for (const one of group.items) log(`    ${row(one)}`);
        }
      }
      log("\nOpen one with: npx wf try <scenario>");
      return 0;
    }
    if (!set && sets.length > 1) {
      const picked = await io.pick({
        title: "Which set?",
        groups: [{ name: "Sets", items: sets }],
        text: (one) => `${one.name} ${one.id}`,
        line: (one) => `${one.name.padEnd(22)} ${all.filter((each) => each.set === one.id).length} scenarios`,
      });
      if (!picked) return 0;
      set = picked.id;
    }
    chosen = await io.pick({ title: "Which scenario?", groups: groupsIn(set), text: (one) => `${one.id} ${one.about ?? ""}`, line: row });
    if (!chosen) return 0;
    log(`${chosen.id}: ${chosen.about ?? ""}`);
  }

  const home = tryHome(config, chosen.id, root);
  const answers = { ...opts.answers };
  const ctx = { ...base, scenario: chosen, answers, keep: opts.keep, dataHome: home };
  // The project asks its own questions, one at a time, each given the answers so far.
  for (let asked = 0; hooks.asks && asked < 20; asked++) {
    const ask = await hooks.asks(chosen, answers, ctx);
    if (!ask || Object.hasOwn(answers, ask.flag)) break;
    answers[ask.flag] = io.interactive ? await io.ask(ask) : (ask.default ?? null);
  }

  const fresh = !opts.keep || !existsSync(join(home, BUILT));
  // The plan comes first, so a wrong answer fails before anything is printed or built.
  const steps = [...((hooks.plan ? await hooks.plan(chosen, answers, ctx) : null) ?? []), ...openSteps(s, home)];
  log("\nTo open this again with no questions:");
  log(`  ${againCommand(chosen.id, answers)}`);
  log(`  npx wf try ${chosen.id} --keep          # reopen it as you left it`);
  log("\nWhat that runs, if you want to do it by hand:");
  for (const step of steps) log(`  ${step}`);
  if (opts.dryRun) {
    log(`\nWould open ${chosen.id} in ${home}${fresh ? ", from a fresh folder" : ", as last left"}.`);
    return 0;
  }

  if (fresh) {
    rmSync(home, { recursive: true, force: true });
    log(`\nBuilding ${chosen.id} in ${home} ...`);
  } else log(`\nOpening last time's ${chosen.id} in ${home} ...`);
  mkdirSync(home, { recursive: true });
  // From here a signal stops the run, not the process, so what prepare started is stopped too.
  let interrupted = false;
  const onSignal = () => (interrupted = true);
  const signals = ["SIGINT", "SIGTERM", "SIGHUP"];
  for (const signal of signals) process.on(signal, onSignal);
  const state = {};
  let ready = {};
  try {
    ready = (await hooks.prepare({ ...ctx, state, fresh, real: false, args: fresh ? ["--fresh", "--scenario", chosen.id] : [] })) ?? {};
    if (fresh) writeFileSync(join(home, BUILT), new Date().toISOString());
    if (interrupted) throw new Error("stopped before the app opened");
    if (ready.message) log(`\n${String(ready.message).trimEnd()}`);
    return await io.open(s, config, home, ready, log, { cancelled: () => interrupted });
  } finally {
    for (const signal of signals) process.off(signal, onSignal);
    if (hooks.stop) await hooks.stop({ ...ctx, state: { ...state, ...(ready.state ?? {}) } });
  }
}
