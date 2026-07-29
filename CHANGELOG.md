# Changelog

All notable changes to this extension are documented here. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and the project uses
[semantic versioning](https://semver.org/spec/v2.0.0.html).

## [0.3.3] - 2026-07-29

### Fixed

- Reordering no longer silently does nothing when the tool removes a line.
  The edit range was computed by matching a common prefix and a common suffix
  without preventing the two from overlapping, which produced a negative length
  whenever the change sat next to repeated text — de-duplicated imports and
  collapsed blank lines being the everyday cases. Depending on the overlap the
  edit was either dropped or applied to the wrong range, in the worst case
  emptying the buffer.
- Line endings are normalised on both sides of the call instead of rewriting
  `\r\r` in the output, so a CRLF document stays CRLF without doubling.
- The tool is found in environments where the console script does not sit next
  to the interpreter. The environment's `sys.prefix` is consulted, which covers
  conda on Windows (`<env>\python.exe` with `<env>\Scripts`), and the tool is
  run as `-m reorder_python_imports` when no console script can be found at
  all — which covers a system interpreter whose scripts went elsewhere.
- On Windows the console script is resolved as `reorder-python-imports.exe`.
- Files larger than 1 MiB no longer fail: the subprocess output limit was left
  at Node's default.
- A failed spawn no longer raises an unhandled `EPIPE` on the extension host.
- An edit is discarded rather than applied at stale offsets if the document
  changed while the tool was running.
- Failures are reported with an actionable message and a `Show Log` action
  instead of a generic "command failed".
- The command handler returns its promise instead of dropping it, so a caller
  that awaits the command — organize-imports-on-save — waits for the edit
  rather than racing it.
- The README documented `editor.codeActionsOnSave` with the boolean values VS
  Code deprecated in 1.83; it now uses `"never"` and `"explicit"`, and the
  snippet it shows is valid JSON.

### Changed

- The tool is invoked with an argument vector rather than through a shell.
  Arguments configured in `reorder-python-imports.args` were interpolated into
  a shell command line, so a workspace could run arbitrary commands through its
  settings. The shell-quoted form documented in the README keeps working: the
  quoting is now resolved by the extension, without any shell evaluation.
- The extension declares that it does not support untrusted or virtual
  workspaces, since it runs an executable resolved from workspace settings.
- The interpreter is resolved through the Python extension's stable
  `environments` API, falling back to the legacy settings API.
- The command is inert on non-Python documents and hidden from the command
  palette unless a Python editor is active.
- Overlapping runs on one document — organize-on-save racing a manual
  invocation — are skipped rather than computing an edit against text that is
  about to be replaced, and a wedged process is stopped after 30 seconds.
- Diagnostics go to a `reorder-python-imports` output channel instead of the
  developer console, and no longer log the whole file on every run.
- The extension is bundled with esbuild and the demo GIF is no longer shipped
  inside the package, which takes the VSIX from about 977 KB to roughly 12 KB.
- The runtime dependency on `deep-equal` was removed; the extension now ships
  no runtime dependencies.
- The extension is compiled with TypeScript 7. typescript-eslint refuses to
  load against that release, so TypeScript 6 is kept alongside it purely as the
  library typescript-eslint parses with; see the note in the README.
- The marketplace listing has an icon, keywords and a changelog, and the
  toolchain is pinned by a committed `package-lock.json`.

## [0.3.2] and earlier

See the [commit history](https://github.com/emaballarin/vscode-reorder-python-imports/commits/master).
