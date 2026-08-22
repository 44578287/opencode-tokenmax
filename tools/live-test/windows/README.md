# TokenMax Dev local live-test harness

Official OpenCode is the controller. TokenMax Dev is the system under test.

Allowed paths:
- `%LOCALAPPDATA%\Programs\OpenCode TokenMax Dev`
- `%LOCALAPPDATA%\Programs\opencode-tokenmax-dev`
- `%APPDATA%\ai.opencode.tokenmax.dev`
- `output/live-test/`

Never touch official OpenCode profile, sessions, or auth.

```
pwsh -File tools/live-test/windows/run-live-test.ps1
```

Launch uses `OPENCODE_PORT` + `OPENCODE_SERVER_PASSWORD` + `OPENCODE_LIVE_TEST=1`.
Those env hooks exist only after the TokenMax Dev build that includes `live-test-auth.json` support.
