# Bahasa Coach

- Use computer use or browser UI automation only when the user explicitly requests it. Do not operate the user's browser or complete login flows on their behalf without that request.
- Develop and validate using terminal tools. Commands: `vp dev`, `vp check`, `vp test`, `vp build`.
- Keep this a local, single-user MVP. Do not add PWA, background services, deployment, Dropbox, or recordings without a new request.
- Preserve both original transcript fragments and explicit recognition revisions. Language feedback is separate.
- Text teaching must use official ChatGPT subscription authentication. Never fall back to a paid text API or pass the voice API key to Codex.
- Never commit `.local/`, `.env`, credentials, or user learning history.
