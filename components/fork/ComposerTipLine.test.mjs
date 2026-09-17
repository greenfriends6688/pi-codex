import assert from "node:assert/strict";
import test from "node:test";
import { createJiti } from "jiti";

const jiti = createJiti(import.meta.url, {
  jsx: { runtime: "automatic" },
  tsconfigPaths: true,
});
const React = await jiti.import("react");
const { renderToStaticMarkup } = await jiti.import("react-dom/server");
const { ComposerTipLine, TIP_KEYS, nextTipIndex } = await jiti.import("./ComposerTipLine.tsx");
const { I18nProvider } = await jiti.import("@/hooks/useI18n");
const { enLocale } = await jiti.import("@/lib/i18n/messages/en");
const { zhCNLocale } = await jiti.import("@/lib/i18n/messages/zh-CN");
const { zhTWLocale } = await jiti.import("@/lib/i18n/messages/zh-TW");

test("every tip exists in all three locales", () => {
  for (const key of TIP_KEYS) {
    for (const [name, locale] of [["en", enLocale], ["zh-CN", zhCNLocale], ["zh-TW", zhTWLocale]]) {
      const value = locale.messages[key];
      assert.equal(typeof value, "string", `${name} is missing ${key}`);
      assert.ok(value.length > 8, `${name}.${key} looks empty`);
    }
  }
});

test("rotation never repeats the tip already on screen", () => {
  for (const count of [12, 5, 2]) {
    for (let current = 0; current < count; current++) {
      for (let attempt = 0; attempt < 20; attempt++) {
        const next = nextTipIndex(current, count);
        assert.ok(next >= 0 && next < count, `out of range: ${next}/${count}`);
        assert.notEqual(next, current, `repeated tip ${current}`);
      }
    }
  }
});

test("a single tip is a no-op instead of an infinite loop", () => {
  assert.equal(nextTipIndex(0, 1), 0);
  assert.equal(nextTipIndex(0, 0), 0);
});

test("the tip line renders one of the known tips", () => {
  // I18nProvider has no locale prop: SSR renders the default (en) locale and the
  // stored/browser locale is applied in an effect, so assert against English here.
  const html = renderToStaticMarkup(
    React.createElement(I18nProvider, null, React.createElement(ComposerTipLine)),
  );
  assert.match(html, /fork-tipline/);
  const texts = TIP_KEYS.map((key) => enLocale.messages[key]);
  assert.ok(texts.some((text) => text && html.includes(text.slice(0, 12))), `no known tip rendered: ${html.slice(0, 200)}`);
});
