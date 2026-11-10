import assert from "node:assert/strict";
import { mkdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { discoverVaults, inspectVault, parseObsidianConfig, readSettings, writeSettings } from "./store.js";

test("reads vault paths out of Obsidian's config", () => {
  const paths = parseObsidianConfig(JSON.stringify({
    vaults: {
      a: { path: "D:\\Notes\\工作" },
      b: { path: "D:\\Notes\\生活" },
      c: { ts: 1 },
    },
  }));
  assert.deepEqual(paths, ["D:\\Notes\\工作", "D:\\Notes\\生活"]);
});

test("accepts a directory with .obsidian and rejects anything else", async () => {
  const root = join(tmpdir(), `wlc-vault-${Date.now()}`);
  const vault = join(root, "日记");
  await mkdir(join(vault, ".obsidian"), { recursive: true });
  await mkdir(join(root, "普通文件夹"), { recursive: true });
  const accepted = await inspectVault(`${vault}/`);
  assert.equal(accepted.ok, true);
  assert.equal(accepted.path, vault);
  const rejected = await inspectVault(join(root, "普通文件夹"));
  assert.equal(rejected.ok, false);
  assert.equal((await inspectVault("相对路径")).ok, false);
});

test("saves the workspace switch and several vaults", async () => {
  const home = join(tmpdir(), `wlc-home-${Date.now()}`);
  const file = join(home, "wikilink-completion.json");
  const saved = await writeSettings(file, {
    includeWorkspace: false,
    vaults: ["/vaults/工作", "/vaults/工作", "/vaults/生活"],
  });
  assert.equal(saved.includeWorkspace, false);
  assert.deepEqual(saved.vaults, ["/vaults/工作", "/vaults/生活"]);
  assert.deepEqual(await readSettings(file), saved);
});

test("imports only real vaults from a config file", async () => {
  const root = join(tmpdir(), `wlc-discover-${Date.now()}`);
  const vault = join(root, "库");
  await mkdir(join(vault, ".obsidian"), { recursive: true });
  const config = join(root, "obsidian.json");
  await writeFile(config, JSON.stringify({
    vaults: {
      ok: { path: vault },
      missing: { path: join(root, "不存在") },
    },
  }));
  assert.deepEqual(await discoverVaults(config), [vault]);
});
