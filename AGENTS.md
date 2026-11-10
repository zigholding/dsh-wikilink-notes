## DeepSeek Harness plugin development

Before changing plugin code, read https://dsh.pub/develop-plugin.md completely. Follow the pinned
runtime contract and verification boundaries there; this repository's own security, testing, and
release rules remain authoritative.

This package targets the Web profile. `[[` completion is detected from the composer draft and
drawn in `conversation.input.overlay`. Note names come from the session workspace via
`GET /api/wikilink-completion/notes`. Do not take a filesystem path from the browser.
