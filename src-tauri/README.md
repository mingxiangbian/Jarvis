# Cyrene Tauri Shell

Phase 8B v0 keeps the Web UI as the source of truth.

Run from the repo root:

```bash
PATH="$HOME/.cargo/bin:$PATH" npm run desktop:dev
```

The Tauri dev shell starts:

```bash
npm run desktop:web -- --port 4317
```

and loads:

```txt
http://127.0.0.1:4317
```

Current boundary:

- Web run boundary defaults to the user home folder when `cyrene --web` is launched without `--cwd`.
- Session, memory, trace, and evolution storage remain under the launch/storage root.
- Signing, notarization, auto-update, packaged Node runtime, tray lifecycle, and close-to-tray behavior are later desktop hardening steps.
