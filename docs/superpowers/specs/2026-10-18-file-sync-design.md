# External file synchronization and conflict resolution

Approved behavior: clean buffers refresh from disk; edited buffers never silently lose text; missing files remain recoverable and are never labelled Saved or silently recreated.

- Main owns paths and baseline byte hashes. Watch parent directories (atomic-save safe), poll metadata as a fallback, and recheck contents on startup, app focus and save. Watchers are hints, not authority.
- Inspection returns same/changed/missing/unreadable plus a main-owned revision token. Permission, binary and oversized reads are unreadable, not missing.
- Clean changed buffers reload only after saving a recoverable previous buffer in the private session. Preserve selection/scroll where feasible. Concurrent editor changes during inspection/reload become conflicts, not discarded edits.
- Dirty changed buffers show a nonmodal conflict banner and tab indicator. A comparison dialog shows editor/disk text, line additions/deletions, and the last synchronized text. Manual merge edits a separate result.
- Reload adopts a revalidated disk snapshot; overwrite/recreate/save-merge require explicit native confirmation and a second disk check after approval. Save As remains separate. Locate uses a native picker and does not overwrite either file.
- Missing files offer Locate, Save As, explicit Recreate. Closing the app checkpoints the buffer without recreating files. Rechecking clears missing state when the same file returns.
- Each tab keeps one recoverable previous buffer across restart; no document text enters diagnostics. Diff computation/rendering is bounded, plain text, with an explicit large-file fallback.
- Preserve UTF-8/BOM/EOL, per-tab undo isolation, session capabilities and baseline hashes. No new runtime dependencies. No automatic merge and no claim of complete filesystem TOCTOU elimination.
- Verify synthetic changed/deleted/renamed/atomic-replaced files, conflicts, stale revisions, approval cancellation, unreadable content, restart, UI diff escaping and actual packaged runtime. Release as 0.3.11; back up and upgrade the owner's existing app, preserving unsaved text (missing-file status is an intentional correction).
