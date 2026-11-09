---
name: workflow-doctor
description: Checks that a project's set-up on the workflow kit is whole, with wf doctor, and fixes what it can with the owner's yes. Use when someone invokes /workflow-doctor, after a kit upgrade, or when a wf command fails in a way that looks like set-up.
---

# Check a project's set-up

1. Run `npx wf doctor`. Each line is OK, FAIL, or SKIP.
2. For each FAIL, run what it names. These change only generated or settings files, so they need no yes:
   - `npx wf docs sync` for docs out of step.
   - `npx wf ai:sync` for agent settings.
   - `npx wf hooks install` for the branch hooks.
3. Ask first for anything else:
   - a package install that changes the lockfile;
   - a plugin install or update;
   - a change to `package.json` or `.workflow/config.json`;
   - a gh sign-in, which the person does themself.
4. Run `npx wf doctor` again, and report each line that is still FAIL, with its reason.
