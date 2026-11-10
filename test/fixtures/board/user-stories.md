# app user stories

The app area's stories, `APP-`.

## Out of scope for now

- **Invite users.** Not a story yet.

## Sign in

### APP-01. Sign in with work email and password

As a Field User, I want to sign in with my work email and password, so that only I can reach the jobs I work on.

Acceptance:

- Given I am not signed in, when I open any page, then I see the sign-in page instead.
- The email is matched without regard to letter case or surrounding spaces.
- Given a wrong password, then I see one message, "Email or password is incorrect", that does not say which was wrong.
- Given 5 failed tries for one email within any 15 minutes, then further tries are refused for 15 minutes (D-APP-002).
  - While that email is slowed down, Sign in is turned off until the wait ends.
- My password is never shown on screen, kept in `plain text`, or written to a log.

### APP-02. Sign out

As a Field User, I want to sign out, so that someone using this computer after me cannot reach my jobs.

Acceptance:

- Given I am signed in, when I choose Sign out, then I see the sign-in page.

### APP-03. Remember me

Removed 2026-11-09: the owner dropped it (D-APP-004).

## Jobs

### APP-04. See my jobs

As a Field User, I want a list of my open jobs, so that I know where to go next.

Acceptance:

- The list shows each open job with its address and due date,
  newest first.
