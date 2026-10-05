import js from "@eslint/js";
import tseslint from "typescript-eslint";
import pluginVue from "eslint-plugin-vue";

/** G3 确定性规则：src/core 内禁止非确定性来源与反向依赖。 */
const G3_RULES = {
  "no-restricted-syntax": [
    "error",
    {
      selector: "CallExpression[callee.object.name='Math'][callee.property.name='random']",
      message: "G3: core 禁止 Math.random，请使用 core/rng 的分流随机（ADR-006）",
    },
    {
      selector: "CallExpression[callee.object.name='Date'][callee.property.name='now']",
      message: "G3: core 禁止 Date.now，时间不属于确定性输入",
    },
    {
      selector: "NewExpression[callee.name='Date']",
      message: "G3: core 禁止 new Date，时间不属于确定性输入",
    },
    {
      selector: "MemberExpression[object.name='window']",
      message: "G3: core 禁止 DOM（window）",
    },
    {
      selector: "MemberExpression[object.name='document']",
      message: "G3: core 禁止 DOM（document）",
    },
    {
      selector: "MemberExpression[object.name='localStorage']",
      message: "G3: core 禁止 localStorage，存档走 systems/save",
    },
    {
      selector: "Identifier[name='performance']",
      message: "G3: core 禁止 performance，时间不属于确定性输入",
    },
  ],
  "no-restricted-imports": [
    "error",
    {
      patterns: [
        {
          group: ["**/ui/**", "**/stores/**", "**/systems/**", "@/ui/**", "@/stores/**", "@/systems/**"],
          message: "G3: core 不得反向依赖 UI / stores / systems",
        },
        {
          group: ["vue", "pinia", "vue-router"],
          message: "G3: core 必须纯 TS，零框架依赖",
        },
      ],
    },
  ],
  "no-restricted-globals": [
    "error",
    "window",
    "document",
    "localStorage",
    "sessionStorage",
    "navigator",
    "alert",
    "fetch",
    "performance",
    "requestAnimationFrame",
    "setTimeout",
    "setInterval",
  ],
};

export default tseslint.config(
  {
    ignores: ["dist/**", "node_modules/**", "coverage/**", "reports/**", "src/**/*.d.ts"],
  },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  ...pluginVue.configs["flat/essential"],
  {
    files: ["**/*.ts", "**/*.vue"],
    languageOptions: {
      parserOptions: {
        parser: tseslint.parser,
        ecmaVersion: "latest",
        sourceType: "module",
        extraFileExtensions: [".vue"],
      },
    },
    rules: {
      "no-undef": "off",
      "@typescript-eslint/no-explicit-any": "off",
      "@typescript-eslint/no-unused-vars": ["error", { argsIgnorePattern: "^_", varsIgnorePattern: "^_" }],
      "vue/multi-word-component-names": "off",
    },
  },
  {
    files: ["src/core/**/*.ts"],
    rules: G3_RULES,
  },
);
