import * as esbuild from "esbuild";

await esbuild.build({
  entryPoints: ["src/host/entry.js"],
  outfile: "lib/index.js",
  bundle: true,
  format: "esm",
  platform: "node",
  target: "node22",
  legalComments: "none",
});

await esbuild.build({
  entryPoints: ["src/client/entry.jsx"],
  outfile: "lib/client.js",
  bundle: true,
  format: "cjs",
  platform: "browser",
  target: "es2022",
  jsx: "transform",
  external: ["react", "react-dom", "react/jsx-runtime"],
  legalComments: "none",
  define: { "process.env.NODE_ENV": '"production"' },
  banner: {
    js: `window.__ModuleLoader__.load({ id: "dsh-wikilink-completion", factory: function (require) {
var module = { exports: {} };
var exports = module.exports;`,
  },
  footer: {
    js: `return module.exports;
} });`,
  },
});
