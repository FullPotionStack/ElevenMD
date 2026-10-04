# Diagnostics and privacy

## What we record

Diagnostics start off and remain off until you enable them. The app records semantic actions such as mode changes, formatting commands, file-operation outcomes, and update outcomes. It uses an allowlist of event categories, enum values, and bounded counts. Unknown fields and arbitrary strings are discarded before storage.

The local history holds at most 200 actions from the last 7 days, with a bounded file size. Older events expire. This is enough to explain a sequence such as "open → Source → Preview → Save failure" without recording the note itself.

We do not record document contents, keystrokes, searches or replacements, clipboard data, file names or paths, URLs, screenshots, passwords or tokens, account names, hostnames, or stable device identifiers. Errors use fixed categories rather than raw error messages or stack traces, which can expose paths and text.

## Controls

In Help → Diagnostics & privacy you can enable or disable logs, inspect the exact sanitized JSON, clear the history, or export a file using a native save dialog. Disabling deletes the stored history. The saved consent decision survives restart; no decision counts as off. If Windows denies both writing and deleting the diagnostics file, the app disables collection in the current process and shows a warning: old disk history and its previous consent decision may remain. Fix the directory permissions before restarting; failed deletion is not successful revocation.

Exports are copies you control. Clearing the app's local history does not delete a file you exported elsewhere. Neither an export nor enabling logs uploads anything.

## Sending a report

Help → Report a bug asks for reproduction steps, expected behavior, and actual behavior. Diagnostics are excluded unless you select the checkbox. A selected summary contains safe app/runtime/OS family/architecture information and a limited recent action history. For a longer log, inspect and export it, then attach it to the GitHub issue yourself.

ElevenMD displays the draft before opening the fixed project issue page. You still need a GitHub account and submit the report yourself. GitHub issues and attachments are public. Do not attach your real document or a screenshot without checking it for private information.

Basic redaction removes obvious paths, email addresses, URLs, and common credential patterns from report text. It cannot recognize all personal information or all secrets. User review is essential. Safe action logs also cannot replay your exact document-dependent bug; use a minimal, non-sensitive example if one is needed.

## Network use

Startup/manual update checks query GitHub's public releases API. Explicit update downloads fetch the installer and its published checksum. The requests include ordinary connection data such as your IP address; they do not include documents or diagnostics. Opening a bug-report draft places only the reviewed report text in the GitHub page URL.

Remote images and spell checking are separate preferences. Remote image loading is off by default. Spell checking is off by default. Local session checkpoints contain your drafts as plaintext and are not part of diagnostics or bug reports.
