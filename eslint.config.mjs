import coreWebVitals from "eslint-config-next/core-web-vitals";
import typescript from "eslint-config-next/typescript";

const eslintConfig = [
  // 产物 / 一次性脚本目录（gitignored）；里面的补丁基线是源文件副本，只会产生重复告警
  { ignores: ["test-results/**"] },
  {
    // Reference checkouts and build output are not part of this project's source.
    // 设计风格/ 与 .playwright-mcp/ 是本地素材与浏览器抓取产物（.gitignore 已忽略），
    // 不属于本项目源码；漏掉它们会让 `npm run lint` 在别人的素材上炸出一堆 TS 规则报错。
    ignores: ["release/**", "参考项目/**", "pi参考项目/**", "家里电脑跑的/**", "设计风格/**", ".playwright-mcp/**"],
  },
  ...coreWebVitals,
  ...typescript,
  {
    rules: {
      "react-hooks/immutability": "off",
      "react-hooks/refs": "off",
      "react-hooks/set-state-in-effect": "off",
    },
  },
  {
    // Last: the Electron main process is CommonJS by construction, and the
    // shared configs above re-enable the rule.
    files: ["electron/**/*.js"],
    rules: { "@typescript-eslint/no-require-imports": "off" },
  },
];

export default eslintConfig;
