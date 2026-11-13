import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const source = await readFile(
  new URL("../src/views/BatchDailyTasks.vue", import.meta.url),
  "utf8",
);

test("batch daily header uses responsive toolbar groups", () => {
  for (const className of [
    "page-header-main",
    "primary-actions",
    "schedule-toolbar",
    "schedule-summary",
    "schedule-actions",
    "log-title-row",
  ]) {
    assert.match(source, new RegExp(`class="${className}"`));
  }
  assert.match(source, /\.schedule-actions\s*\{[^}]*flex-wrap:\s*wrap/);
  assert.match(
    source,
    /@media \(max-width: 768px\)[\s\S]*\.schedule-actions\s*\{[^}]*grid-template-columns:\s*repeat\(2/,
  );
});

test("log controls can wrap instead of collapsing Chinese labels", () => {
  assert.match(
    source,
    /\.log-header-controls\s*\{[^}]*flex-wrap:\s*wrap/,
  );
});
