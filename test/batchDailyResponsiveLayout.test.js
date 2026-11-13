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
  assert.match(
    source,
    /\.schedule-actions\s*\{[^}]*grid-template-columns:\s*repeat\(auto-fit,\s*minmax\(120px,\s*1fr\)\)/,
  );
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

test("scheduled task modal uses a compact paginated table with last run", () => {
  assert.match(source, /class="task-table"/);
  assert.match(source, /上次执行/);
  assert.match(source, /formatTaskLastRun\(task\.lastRunAt\)/);
  assert.match(source, /paginatedScheduledTasks/);
});
