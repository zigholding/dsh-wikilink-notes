/**
 * Settings → 双链补全. Paths are sent to the host, which only accepts
 * directories that contain an `.obsidian` folder.
 */
import React, { useEffect, useState } from "react";

const EMPTY = { includeWorkspace: true, vaults: [], noteChains: [], discovered: [] };

export class SettingsBoundary extends React.Component {
  constructor(props) {
    super(props);
    this.state = { error: "" };
  }

  static getDerivedStateFromError(error) {
    return { error: error instanceof Error ? error.message : String(error) };
  }

  render() {
    if (this.state.error) {
      return React.createElement("p", { className: "wlc-settings-error" }, `双链补全设置没有打开：${this.state.error}`);
    }
    return React.createElement(SettingsSection);
  }
}

export function SettingsSection() {
  const [settings, setSettings] = useState(EMPTY);
  const [text, setText] = useState("");
  const [services, setServices] = useState("");
  const [dirty, setDirty] = useState(false);
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

  useEffect(() => {
    if (!dirty) {
      setText(settings.vaults.join("\n"));
      setServices(settings.noteChains.join("\n"));
    }
  }, [settings.vaults, settings.noteChains, dirty]);

  function lines(value) {
    return value.split(/\r?\n/u).map((line) => line.trim()).filter(Boolean);
  }

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
          noteChains: next.noteChains,
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
      <h3 className="wlc-settings-title">双链补全</h3>
      <p className="wlc-settings-lead">
        输入 <code>[[</code> 时按这些来源补全笔记名。本机仓库每行一个绝对路径，目录里要有 <code>.obsidian</code>。另一台电脑上的 Obsidian 填写 NoteChain 的 <code>/mcp</code> 地址。
      </p>
      <label className="wlc-check">
        <input
          type="checkbox"
          checked={settings.includeWorkspace}
          disabled={busy}
          onChange={(event) => save({
            includeWorkspace: event.target.checked,
            vaults: lines(text),
            noteChains: lines(services),
          })}
        />
        同时包含当前工作区
      </label>
      <form
        className="wlc-paths"
        onSubmit={(event) => {
          event.preventDefault();
          save({
            includeWorkspace: settings.includeWorkspace,
            vaults: lines(text),
            noteChains: lines(services),
          }).then((saved) => {
            if (saved) setDirty(false);
          });
        }}
      >
        <textarea
          value={text}
          rows={4}
          spellCheck={false}
          aria-label="Obsidian 仓库路径"
          placeholder={"D:\\Notes\\工作\nD:\\Notes\\生活"}
          onChange={(event) => {
            setDirty(true);
            setText(event.target.value);
          }}
        />
        <textarea
          value={services}
          rows={3}
          spellCheck={false}
          aria-label="NoteChain 服务地址"
          placeholder={"http://192.168.1.8:3000/mcp"}
          onChange={(event) => {
            setDirty(true);
            setServices(event.target.value);
          }}
        />
        <button type="submit" disabled={busy}>保存</button>
      </form>
      {unused.length > 0 ? (
        <div className="wlc-discovered">
          <span>本机 Obsidian 里还有这些库</span>
          {unused.map((path) => (
            <button
              key={path}
              type="button"
              disabled={busy}
              onClick={() => {
                setDirty(true);
                setText((current) => current.trim().length === 0 ? path : `${current.replace(/\s+$/u, "")}\n${path}`);
              }}
            >
              填入 {path}
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
    noteChains: Array.isArray(payload?.noteChains) ? payload.noteChains.filter((item) => typeof item === "string") : [],
    discovered: Array.isArray(payload?.discovered) ? payload.discovered.filter((item) => typeof item === "string") : [],
  };
}

function installSettingsStyles() {
  const id = "dsh-wikilink-completion-settings";
  if (document.getElementById(id)) return undefined;
  const style = document.createElement("style");
  style.id = id;
  style.textContent = `
.wlc-settings { display: flex; flex-direction: column; gap: 12px; max-width: 640px; width: 100%; }
.wlc-settings-title { margin: 0; font-size: 14px; font-weight: 600; }
.wlc-settings-lead, .wlc-settings-muted { color: var(--dsw-alias-fg-muted, rgba(246, 241, 232, 0.62)); font-size: 13px; margin: 0; }
.wlc-settings code { font-family: ui-monospace, monospace; }
.wlc-check { display: flex; gap: 8px; align-items: center; }
.wlc-paths { display: flex; flex-direction: column; gap: 8px; align-items: stretch; }
.wlc-paths textarea {
  width: 100%;
  box-sizing: border-box;
  resize: vertical;
  min-height: 96px;
  border-radius: 8px;
  border: 1px solid var(--dsw-alias-border, rgba(255, 244, 224, 0.14));
  background: transparent;
  color: inherit;
  padding: 8px 10px;
  font: 13px/1.45 ui-monospace, "Sarasa Mono SC", monospace;
}
.wlc-discovered { display: flex; gap: 8px; align-items: center; flex-wrap: wrap; }
.wlc-settings button {
  border-radius: 8px;
  border: 1px solid var(--dsw-alias-border, rgba(255, 244, 224, 0.14));
  background: transparent;
  color: inherit;
  padding: 6px 10px;
  align-self: flex-start;
}
.wlc-settings-error { color: var(--dsw-alias-danger, #e07a5f); font-size: 13px; margin: 0; }
`;
  document.head.appendChild(style);
  return () => style.remove();
}
