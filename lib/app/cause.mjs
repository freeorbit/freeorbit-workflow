// Why an app or a server stopped, in one line, from its log: the driver puts
// it first in a failed start's error, and wf screens reports it per screen,
// so a panic is named even under a long backtrace and systemd's own lines.

/** A line that says nothing of why: systemd's when a unit ends, and a graphics stack's warnings. */
const NOISE = [
  /\.service: |^(?:Started|Stopped|Starting|Stopping) |Consumed .* CPU|Main process exited|Failed with result|Deactivated successfully/,
  /GBM buffer|libEGL|MESA|Gtk-(?:WARNING|CRITICAL|Message)|GLib-GIO|dbus-daemon|AT-SPI|Fontconfig|^\s*(?:\d+:|at )\s/,
];
const noise = (line) => NOISE.some((pattern) => pattern.test(line));

/**
 * The cause in a log, at most 300 characters: the last Rust panic's message
 * and place, else the last line that names an error, else the last line that
 * is not noise, else "no output". The last, so an earlier run of the same
 * unit in the log does not stand in for this one.
 */
export function exitCause(text) {
  const lines = String(text ?? "").replace(/\r/g, "").split("\n").map((line) => line.trim()).filter(Boolean);
  const own = lines.filter((line) => !noise(line));
  const panic = own.findLastIndex((line) => /panicked at/.test(line));
  if (panic >= 0) {
    // Since Rust 1.73 the message is the line after "panicked at <place>:"; before, it is on that line.
    const message = /panicked at .+:\d+:\d+:$/.test(own[panic]) ? own[panic + 1] : own[panic].replace(/^.*panicked at /, "");
    return [message, own[panic].match(/panicked at (.+?):?$/)?.[1]].filter(Boolean).join(" at ").slice(0, 300);
  }
  const error = own.findLast((line) => /\b(?:error|failed|could not|cannot|panic)\b/i.test(line));
  return (error ?? own.at(-1) ?? lines.at(-1) ?? "no output").slice(0, 300);
}

/** A cause with what changes from run to run, such as times, numbers, and process ids, taken out, so two runs' causes compare. */
export const sameCause = (cause) => String(cause).replace(/\d{4}-\d{2}-\d{2}[T ][\d:.]+Z?/g, "").replace(/0x[0-9a-f]+/gi, "").replace(/\d+/g, "#").trim();
