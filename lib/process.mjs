// Running the project's own commands from the kit: one argument quoted for
// sh, and a named command from the config with its arguments after it.

/** An argument quoted for sh, unless it is plainly safe. */
export const quote = (arg) => (/^[\w@%+=:,./-]+$/.test(arg) ? arg : `'${arg.replaceAll("'", "'\\''")}'`);

/** The shell command for one of the project's named steps, such as testdata.commands.index, or null when it has none. */
export function projectCommand(commands, name, args) {
  const base = commands[name];
  return base ? [base, ...args.map(quote)].join(" ") : null;
}
