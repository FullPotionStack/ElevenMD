# Diagnostics and privacy

## What we record

Diagnostics start off and remain off until you enable them. The app records semantic actions such as mode changes, formatting commands, file-operation outcomes, and update outcomes. It uses an allowlist of event categories, enum values, and bounded counts. Unknown fields and arbitrary strings are discarded before storage.

The local history holds at most 200 actions from the last 7 days, with a bounded file size. Older events expire. This is enough to explain a sequence such as "open → Source → Preview → Save failure" without recording the note itself.

We do not record document contents, keystrokes, searches or replacements, clipboard data, file names or paths, URLs, screenshots, passwords or tokens, account names, hostnames, or stable device identifiers. Errors use fixed categories rather than raw error messages or stack traces, which can expose paths and text.

## Controls

In Settings → Privacy & diagnostics you can enable or disable logs, inspect the exact sanitized JSON, clear the history, or export a file using a native save dialog. Disabling deletes the stored history. The saved consent decision survives restart; no decision counts as off. If Windows denies both writing and deleting the diagnostics file, the app disables collection in the current process and shows a warning: old disk history and its previous consent decision may remain. Fix the directory permissions before restarting; failed deletion is not successful revocation.

Exports are copies you control. Clearing the app's local history does not delete a file you exported elsewhere. Neither an export nor enabling logs uploads anything.

## Reporting

This build has no in-app report submission, email delivery, or GitHub issue-draft feature. Local diagnostics never leave the computer unless you export a copy and share it yourself.

## Network use

Startup/manual update checks query GitHub's public releases API. Explicit update downloads fetch the installer and its published checksum. The requests include ordinary connection data such as your IP address; they do not include documents or diagnostics.

Remote images and spell checking are separate preferences. Remote image loading is off by default. Spell checking is off by default. Local session checkpoints contain your drafts as plaintext and are not part of diagnostics.
