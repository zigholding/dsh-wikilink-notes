"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { findOpenTrigger, replaceTrigger } from "../../../src/complete/trigger.js";
import { rankNotes } from "../../../src/complete/rank.js";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

type Note = {
  name: string;
  link: string;
  folder?: string;
  aliases?: string[];
};

type Message = {
  id: string;
  role: "user" | "assistant";
  text: string;
};

const STORAGE_KEY = "wlc-notes-v1";

const SAMPLE: Note[] = [
  { name: "周会纪要", link: "周会纪要", folder: "工作", aliases: ["周会"] },
  { name: "产品路线图", link: "产品路线图", folder: "工作", aliases: ["路线图"] },
  { name: "曼谷街头美食", link: "旅行/曼谷街头美食", folder: "旅行", aliases: ["曼谷", "美食"] },
  { name: "曼谷笔记", link: "旅行/曼谷笔记", folder: "旅行", aliases: [] },
  { name: "阅读清单", link: "阅读清单", folder: "生活", aliases: ["书单"] },
  { name: "插件设计", link: "插件设计", folder: "DeepSeek Harness", aliases: ["dsh"] },
];

const OPENING: Message = {
  id: "opening",
  role: "assistant",
  text: "在输入框里打 [[ ，我会列出笔记名称。方向键挑选，回车插成 [[笔记名]]。",
};

export function ComposerLab() {
  const [notes, setNotes] = useState<Note[]>(SAMPLE);
  const [ready, setReady] = useState(false);
  const [storageNote, setStorageNote] = useState("示例笔记存在这台浏览器里。");
  const [messages, setMessages] = useState<Message[]>([OPENING]);
  const [draft, setDraft] = useState("");
  const [caret, setCaret] = useState(0);
  const [active, setActive] = useState(0);
  const [suppressed, setSuppressed] = useState(false);
  const [name, setName] = useState("");
  const [folder, setFolder] = useState("");
  const [alias, setAlias] = useState("");
  const [formError, setFormError] = useState("");
  const fieldRef = useRef<HTMLTextAreaElement>(null);
  const listRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (raw) {
        const parsed = JSON.parse(raw) as unknown;
        const loaded = Array.isArray(parsed) ? parsed.filter(isNote) : [];
        setNotes(relink(loaded));
        setStorageNote(loaded.length === 0 ? "笔记列表是空的。先在左侧加一篇。" : "笔记保存在这台浏览器里。");
      }
    } catch {
      setStorageNote("浏览器没能保存笔记，这次刷新前的改动只留在当前页面。");
    }
    setReady(true);
  }, []);

  useEffect(() => {
    if (!ready) return;
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(notes));
    } catch {
      setStorageNote("浏览器没能保存笔记，这次刷新前的改动只留在当前页面。");
    }
  }, [notes, ready]);

  useEffect(() => {
    setSuppressed(false);
  }, [draft]);

  const trigger = useMemo(() => (suppressed ? null : findOpenTrigger(draft, caret)), [draft, caret, suppressed]);
  const ranked = useMemo(() => (trigger ? rankNotes(notes, trigger.query, 8) : []), [notes, trigger]);

  useEffect(() => {
    setActive(0);
  }, [trigger?.query]);

  useEffect(() => {
    const node = listRef.current?.querySelector<HTMLElement>('[data-active="true"]');
    node?.scrollIntoView({ block: "nearest" });
  }, [active, ranked.length]);

  function rememberCaret(value: string, nextCaret: number) {
    setDraft(value);
    setCaret(nextCaret);
  }

  function pick(link: string) {
    if (!trigger) return;
    const next = replaceTrigger(draft, trigger, link);
    const caretAfter = trigger.start + link.length + 4;
    setDraft(next);
    setCaret(caretAfter);
    requestAnimationFrame(() => {
      const field = fieldRef.current;
      if (!field) return;
      field.focus();
      field.setSelectionRange(caretAfter, caretAfter);
    });
  }

  function send() {
    const text = draft.trim();
    if (!text) return;
    setMessages((current) => [
      ...current,
      { id: crypto.randomUUID(), role: "user", text },
      {
        id: crypto.randomUUID(),
        role: "assistant",
        text: replyFor(text),
      },
    ]);
    setDraft("");
    setCaret(0);
  }

  function onKeyDown(event: React.KeyboardEvent<HTMLTextAreaElement>) {
    if (event.nativeEvent.isComposing) return;
    if (!trigger) {
      if (event.key === "Enter" && !event.shiftKey) {
        event.preventDefault();
        send();
      }
      return;
    }
    if (event.key === "ArrowDown" && ranked.length > 0) {
      event.preventDefault();
      setActive((current) => Math.min(current + 1, ranked.length - 1));
    } else if (event.key === "ArrowUp" && ranked.length > 0) {
      event.preventDefault();
      setActive((current) => Math.max(current - 1, 0));
    } else if (event.key === "Enter" && !event.shiftKey && ranked.length > 0) {
      event.preventDefault();
      const hit = ranked[Math.min(active, ranked.length - 1)];
      if (hit) pick(hit.note.link);
    } else if (event.key === "Escape") {
      event.preventDefault();
      setSuppressed(true);
    } else if (event.key === "Enter" && !event.shiftKey) {
      event.preventDefault();
      send();
    }
  }

  function addNote() {
    const nextName = name.trim();
    if (!nextName) {
      setFormError("先写笔记名称。");
      return;
    }
    if (/[\][\n\r]/u.test(nextName) || /[\][\n\r]/u.test(folder) || /[\][\n\r]/u.test(alias)) {
      setFormError("名称里不要写方括号。");
      return;
    }
    const nextAlias = alias.trim();
    setNotes((current) =>
      relink([
        ...current,
        {
          name: nextName,
          link: nextName,
          folder: folder.trim(),
          aliases: nextAlias ? [nextAlias] : [],
        },
      ]),
    );
    setName("");
    setFolder("");
    setAlias("");
    setFormError("");
  }

  return (
    <div className="mx-auto grid min-h-dvh w-full max-w-6xl gap-6 px-4 py-6 md:grid-cols-[280px_minmax(0,1fr)] md:px-6">
      <aside className="flex flex-col gap-4 rounded-2xl border bg-card p-4">
        <div>
          <p className="text-xs tracking-wide text-muted-foreground">笔记</p>
          <h2 className="mt-1 text-lg font-semibold">名称会在 [[ 后出现</h2>
          <p className="mt-2 text-sm text-muted-foreground">{storageNote}</p>
        </div>
        <form
          className="grid gap-2"
          onSubmit={(event) => {
            event.preventDefault();
            addNote();
          }}
        >
          <Input value={name} placeholder="笔记名称" aria-label="笔记名称" onChange={(event) => setName(event.target.value)} />
          <Input value={folder} placeholder="文件夹，可选" aria-label="文件夹" onChange={(event) => setFolder(event.target.value)} />
          <Input value={alias} placeholder="别名，可选" aria-label="别名" onChange={(event) => setAlias(event.target.value)} />
          {formError ? <p className="text-sm text-destructive">{formError}</p> : null}
          <Button type="submit">加入笔记</Button>
        </form>
        <ul className="flex max-h-80 flex-col gap-1 overflow-auto md:max-h-none">
          {notes.length === 0 ? <li className="text-sm text-muted-foreground">还没有笔记。</li> : null}
          {notes.map((note) => (
            <li key={note.link} className="flex items-start justify-between gap-2 rounded-lg px-2 py-1.5 hover:bg-muted">
              <span className="min-w-0">
                <span className="block truncate text-sm">{note.name}</span>
                <span className="block truncate text-xs text-muted-foreground">
                  {note.folder || "未分类"}
                  {note.aliases?.length ? ` · ${note.aliases.join("、")}` : ""}
                </span>
              </span>
              <Button
                type="button"
                variant="ghost"
                size="xs"
                onClick={() => setNotes((current) => relink(current.filter((item) => item.link !== note.link)))}
              >
                移除
              </Button>
            </li>
          ))}
        </ul>
      </aside>

      <section className="flex min-h-[70dvh] flex-col rounded-2xl border bg-background">
        <header className="border-b px-4 py-4 md:px-6">
          <p className="text-xs tracking-wide text-muted-foreground">对话框</p>
          <h1 className="mt-1 text-xl font-semibold">输入 [[ 提示笔记名称</h1>
        </header>
        <div className="flex flex-1 flex-col gap-3 overflow-auto px-4 py-4 md:px-6">
          {messages.map((message) => (
            <article
              key={message.id}
              className={
                message.role === "user"
                  ? "ml-8 rounded-2xl bg-secondary px-4 py-3 text-sm"
                  : "mr-8 rounded-2xl border px-4 py-3 text-sm"
              }
            >
              <p className="mb-1 text-xs text-muted-foreground">{message.role === "user" ? "你" : "对话"}</p>
              <MessageText text={message.text} />
            </article>
          ))}
        </div>
        <div className="px-4 pb-4 md:px-6" data-composer-card>
          <div className="relative rounded-2xl border bg-card p-3">
            {trigger ? (
              <div
                ref={listRef}
                className="absolute inset-x-3 bottom-[calc(100%+8px)] z-20 max-h-72 overflow-auto rounded-xl border bg-popover p-1.5 shadow-lg"
                role="listbox"
                aria-label="笔记名称"
              >
                {notes.length === 0 ? (
                  <p className="px-2 py-2 text-sm text-muted-foreground">还没有笔记。先在左侧加一篇。</p>
                ) : ranked.length === 0 ? (
                  <p className="px-2 py-2 text-sm text-muted-foreground">没有匹配的笔记</p>
                ) : (
                  ranked.map((item, index) => (
                    <button
                      key={item.note.link}
                      type="button"
                      role="option"
                      aria-selected={index === active}
                      data-active={index === active ? "true" : "false"}
                      className="flex w-full items-baseline gap-2 rounded-lg px-2 py-2 text-left text-sm data-[active=true]:bg-muted"
                      onMouseDown={(event) => {
                        event.preventDefault();
                        pick(item.note.link);
                      }}
                      onMouseEnter={() => setActive(index)}
                    >
                      <span className="font-mono text-xs text-muted-foreground">[[</span>
                      <span className="min-w-0">
                        <span className="block truncate">{item.note.name}</span>
                        <span className="block truncate text-xs text-muted-foreground">
                          {item.note.folder || "未分类"}
                          {item.hint ? ` · 别名 ${item.hint}` : ""}
                          {item.note.link !== item.note.name ? ` · ${item.note.link}` : ""}
                        </span>
                      </span>
                    </button>
                  ))
                )}
                <p className="px-2 pt-1 text-xs text-muted-foreground">↑↓ 选择 · Enter 插入 · Esc 关闭</p>
              </div>
            ) : null}
            <textarea
              ref={fieldRef}
              value={draft}
              rows={3}
              placeholder="输入 [[ 开始查找笔记"
              aria-label="对话输入"
              className="w-full resize-none bg-transparent text-sm outline-none placeholder:text-muted-foreground"
              onChange={(event) => rememberCaret(event.target.value, event.target.selectionStart ?? 0)}
              onSelect={(event) => setCaret(event.currentTarget.selectionStart ?? 0)}
              onKeyDown={onKeyDown}
            />
            <div className="flex items-center justify-between gap-3">
              <p className="text-xs text-muted-foreground">Enter 发送，Shift+Enter 换行。补全打开时 Enter 插入笔记名。</p>
              <Button type="button" onClick={send} disabled={!draft.trim()}>
                发送
              </Button>
            </div>
          </div>
        </div>
      </section>
    </div>
  );
}

function MessageText({ text }: { text: string }) {
  const parts = text.split(/(\[\[[^\]\n]+\]\])/u);
  return (
    <p className="whitespace-pre-wrap">
      {parts.map((part, index) =>
        part.startsWith("[[") ? (
          <span key={`${part}-${index}`} className="text-amber-700 dark:text-amber-200">
            {part}
          </span>
        ) : (
          <span key={`${index}-${part.slice(0, 12)}`}>{part}</span>
        ),
      )}
    </p>
  );
}

function replyFor(text: string) {
  const links = [...text.matchAll(/\[\[([^\]\n]+)\]\]/gu)].map((match) => match[1]);
  if (links.length === 0) return "收到。想引用笔记时，直接输入 [[ 。";
  return `已看到这些笔记：${links.map((link) => `[[${link}]]`).join("、")}。装进 DeepSeek Harness 后，名称来自当前工作区里的 Markdown 文件。`;
}

function isNote(value: unknown): value is Note {
  if (!value || typeof value !== "object") return false;
  const note = value as Note;
  return typeof note.name === "string" && typeof note.link === "string" && note.name.length > 0 && note.link.length < 300;
}

function relink(notes: Note[]): Note[] {
  const counts = new Map<string, number>();
  for (const note of notes) counts.set(note.name, (counts.get(note.name) ?? 0) + 1);
  return notes.map((note) => {
    if ((counts.get(note.name) ?? 0) > 1) {
      return { ...note, link: `${note.folder || "未分类"}/${note.name}` };
    }
    return note.link && note.link !== note.name ? note : { ...note, link: note.name };
  });
}
