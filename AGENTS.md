## DeepSeek Harness plugin development

Before changing plugin code, read https://dsh.pub/develop-plugin.md completely. Follow the pinned
runtime contract and verification boundaries there; this repository's own security, testing, and
release rules remain authoritative.

`[[` completion is detected from the composer draft and drawn in `conversation.input.overlay`.
Note names come from the session workspace and from Obsidian vaults saved in
`$DSH_HOME/wikilink-completion.json`, via `GET /api/wikilink-completion/notes`. The vault form is
registered on `settings.general.item` so it appears on the general settings page. Vault paths are
accepted only on `PUT /api/wikilink-completion/settings`, and only when the directory contains
`.obsidian`. The notes request must not take a filesystem path from the browser.
