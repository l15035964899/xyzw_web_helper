import assert from "node:assert/strict";
import test from "node:test";
import { loadModule } from "./helpers/loadModule.js";

test("browser manual addLog entries are persisted with browser source", async () => {
  const sent = [];
  const module = await loadModule(
    new URL("../src/utils/browserLogPersistence.js", import.meta.url),
    {
      "@/api/batchSchedules": {
        requestBatchServer: async (path, options) => {
          sent.push({ path, options });
          return { accepted: options.body.logs.length };
        },
      },
    },
  );

  module.queueBrowserLog({
    type: "warning",
    message: "浏览器手动任务日志",
  });
  await module.flushBrowserLogs();

  assert.equal(sent.length, 1);
  assert.equal(sent[0].path, "/api/logs/db/batch");
  assert.match(sent[0].options.body.logs[0].run_id, /^browser_/);
  assert.equal(sent[0].options.body.logs[0].source, "browser-manual");
  assert.equal(sent[0].options.body.logs[0].level, "warning");
  assert.equal(
    sent[0].options.body.logs[0].message,
    "浏览器手动任务日志",
  );
});
