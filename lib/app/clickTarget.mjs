// What a click step names: `click Sage` or `click Sage in Scheme`, where the
// second names the group the element sits in, such as a form row's label.
// It reads only the step's words.

/** The label to click and the group it must sit in, if one is named. */
export function clickTarget(args) {
  const at = args.indexOf("in");
  if (at > 0 && at === args.length - 2) return { label: args.slice(0, at).join(" "), within: args[at + 1] };
  return { label: args.join(" "), within: null };
}

/** A group's name as a label shows it, with no colon and no case. */
export function groupName(text) {
  return String(text ?? "").trim().replace(/:$/, "").trim().toLowerCase();
}
