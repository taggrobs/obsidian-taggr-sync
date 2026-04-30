import obsidianmd from "eslint-plugin-obsidianmd";
import tsparser from "@typescript-eslint/parser";

export default [
  {
    files: ["src/**/*.ts"],
    plugins: { obsidianmd },
    languageOptions: {
      parser: tsparser,
      parserOptions: {
        project: "./tsconfig.json",
      },
    },
    rules: Object.fromEntries(
      Object.keys(obsidianmd.configs.recommended).map(rule => {
        if (rule === "obsidianmd/ui/sentence-case") {
          return [rule, ["error", { allowAutoFix: true }]];
        }
        return [rule, "error"];
      })
    ),
  },
];
