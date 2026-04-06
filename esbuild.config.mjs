import esbuild from "esbuild";
import process from "process";
import builtins from "builtin-modules";

const prod = process.argv[2] === "production";

esbuild
    .build({
        entryPoints: ["src/main.ts"],
        bundle: true,
        external: [
            "obsidian",
            "electron",
            "@codemirror/autocomplete",
            "@codemirror/collab",
            "@codemirror/commands",
            "@codemirror/language",
            "@codemirror/lint",
            "@codemirror/search",
            "@codemirror/state",
            "@codemirror/view",
            "@lezer/common",
            "@lezer/highlight",
            "@lezer/lr",
        ],
        format: "cjs",
        platform: "browser",
        target: "es2020",
        alias: {
            "stream": "stream-browserify",
        },
        logLevel: "info",
        sourcemap: prod ? false : "inline",
        treeShaking: true,
        outfile: "main.js",
        minify: prod,
        define: {
            "process.env.NODE_ENV": prod ? '"production"' : '"development"',
            global: "globalThis",
        },
    })
    .catch(() => process.exit(1));
