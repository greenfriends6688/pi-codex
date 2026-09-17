import assert from "node:assert/strict";
import test from "node:test";
import { createJiti } from "jiti";

const jiti = createJiti(import.meta.url, {
  jsx: { runtime: "automatic" },
  tsconfigPaths: true,
});
const React = await jiti.import("react");
const { renderToStaticMarkup } = await jiti.import("react-dom/server");
const { NewSessionHome } = await jiti.import("./NewSessionHome.tsx");
const { I18nProvider } = await jiti.import("@/hooks/useI18n");

function render(props) {
  return renderToStaticMarkup(
    React.createElement(I18nProvider, null, React.createElement(NewSessionHome, props)),
  );
}

test("shows the project name and one card per starter", () => {
  const html = render({ cwd: "/Users/me/projects/pi-web", isMobile: false, onInsertPrompt: () => {} });

  // Title uses the basename, not the full path.
  assert.match(html, /pi-web/);
  assert.doesNotMatch(html, /\/Users\/me\/projects\/pi-web\?/);
  assert.equal((html.match(/<button/g) ?? []).length, 4);
  assert.match(html, /grid-template-columns:repeat\(4, minmax\(0, 1fr\)\)/);
});

test("falls back to the generic title without a cwd and stacks cards on mobile", () => {
  const html = render({ cwd: null, isMobile: true, onInsertPrompt: () => {} });

  assert.match(html, /grid-template-columns:1fr 1fr/);
  assert.equal((html.match(/<button/g) ?? []).length, 4);
});
