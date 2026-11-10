/**
 * Settings → 双链补全. Paths are sent to the host, which only accepts
 * directories that contain an `.obsidian` folder.
 */
import { useEffect, useState } from "react";

const EMPTY = { includeWorkspace: true, vaults: [], discovered: [] };

export function SettingsSection() {
  const [settings, setSettings] = useState(EMPTY);
  const [draft, setDraft] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => installSettingsStyles(), []);
  useEffect(() => {
    let gone = false;
    fetch("/api/wikilink-completion/settings")
      .then(async (response) => {
        const payload = await response.json().catch(() => ({}));
        if (!response.ok) throw new Error(payload.error || "设置读不出来");
        if (!gone) setSettings(normalize(payload));
      })
      .catch((reason) => {
        if (!gone) setError(reason instanceof Error ? reason.message : "设置读不出来");
      });
    return () => {
      gone = true;
    };
  }, []);

  async function save(next) {
    setBusy(true);
    setError("");
    try {
      const response = await fetch("/api/wikilink-completion/settings", {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          includeWorkspace: next.includeWorkspace,
          vaults: next.vaults,
        }),
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(payload.error || "没有保存");
      setSettings(normalize(payload));
      window.dispatchEvent(new Event("wlc-settings-saved"));
      return true;
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "没有保存");
      return false;
    } finally {
      setBusy(false);
    }
  }

  const unused = settings.discovered.filter((path) => !settings.vaults.includes(path));

  return (
    <section className="wlc-settings">
      <p className="wlc-settings-lead">
        输入 <code>[[</code> 时，从这些目录里的 Markdown 文件名补全。可以同时使用当前会话工作区和多个 Obsidian 仓库。
      </p>
      <label className="wlc-check">
        <input
          type="checkbox"
          checked={settings.includeWorkspace}
          disabled={busy}
          onChange={(event) => save({ ...settings, includeWorkspace: event.target.checked })}
        />
        同时包含当前工作区
      </label>
      <ul className="wlc-vaults">
        {settings.vaults.length === 0 ? <li className="wlc-settings-muted">还没有添加仓库</li> : null}
        {settings.vaults.map((path) => (
          <li key={path}>
            <span>{path}</span>
            <button type="button" disabled={busy} onClick={() => save({ ...settings, vaults: settings.vaults.filter((item) => item !== path) })}>
              移除
            </button>
          </li>
        ))}
      </ul>
      <form
        className="wlc-add"
        onSubmit={(event) => {
          event.preventDefault();
          const path = draft.trim();
          if (!path || settings.vaults.includes(path)) return;
          save({ ...settings, vaults: [...settings.vaults, path] }).then((saved) => {
            if (saved) setDraft("");
          });
        }}
      >
        <input
          value={draft}
          placeholder="D:\Notes\我的库"
          aria-label="Obsidian 仓库路径"
          onChange={(event) => setDraft(event.target.value)}
        />
        <button type="submit" disabled={busy || draft.trim().length === 0}>添加</button>
      </form>
      {unused.length > 0 ? (
        <div className="wlc-discovered">
          <span>本机 Obsidian 里还有这些库</span>
          {unused.map((path) => (
            <button key={path} type="button" disabled={busy} onClick={() => save({ ...settings, vaults: [...settings.vaults, path] })}>
              加入 {path}
            </button>
          ))}
        </div>
      ) : null}
      {error ? <p className="wlc-settings-error">{error}</p> : null}
    </section>
  );
}

function normalize(payload) {
  return {
    includeWorkspace: payload?.includeWorkspace !== false,
    vaults: Array.isArray(payload?.vaults) ? payload.vaults.filter((item) => typeof item === "string") : [],
    discovered: Array.isArray(payload?.discovered) ? payload.discovered.filter((item) => typeof item === "string") : [],
  };
}

function installSettingsStyles() {
  const id = "dsh-wikilink-completion-settings";
  if (document.getElementById(id)) return undefined;
  const style = document.createElement("style");
  style.id = id;
  style.textContent = `
.wlc-settings { display: flex; flex-direction: column; gap: 12px; max-width: 640px; }
.wlc-settings-lead, .wlc-settings-muted { color: var(--dsw-alias-fg-muted, rgba(246, 241, 232, 0.62)); font-size: 13px; }
.wlc-settings code { font-family: ui-monospace, monospace; }
.wlc-check { display: flex; gap: 8px; align-items: center; }
.wlc-vaults { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: 6px; }
.wlc-vaults li, .wlc-add, .wlc-discovered { display: flex; gap: 8px; align-items: center; }
.wlc-vaults span, .wlc-add input { flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; }
.wlc-add input, .wlc-settings button {
  border-radius: 8px;
  border: 1px solid var(--dsw-alias-border, rgba(255, 244, 224, 0.14));
  background: transparent;
  color: inherit;
  padding: 6px 10px;
}
.wlc-discovered { flex-wrap: wrap; }
.wlc-settings-error { color: var(--dsw-alias-danger, #e07a5f); font-size: 13px; margin: 0; }
`;
  document.head.appendChild(style);
  return () => style.remove();
}
