# Security

The kit runs inside your project as you: its scripts read your files, and its hooks can allow or block an agent's actions. Treat a change to it like a change to your build tools.

## Reporting a problem

Open a private security advisory on this repository (Security, then "Report a vulnerability"), or contact the maintainer directly. Do not open a public issue for a hook that can be bypassed, a script that reads outside the project, or a prompt that leaks data.

## What the kit promises

- **No network.** The scripts use Node's standard library only and make no network calls.
- **Inside the project.** Scripts read only the git work tree they run in.
- **No dependencies.** The package has none, so installing it adds no third-party code.
