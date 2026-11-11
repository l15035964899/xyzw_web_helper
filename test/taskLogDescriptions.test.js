import assert from "node:assert/strict";
import test from "node:test";
import {
  explainLogError,
  formatTaskLogMessage,
} from "../render-backend/lib/taskLogDescriptions.js";
import { formatLogMessage } from "../src/utils/serverTaskLog.js";

test("successful command logs include a readable action description", () => {
  assert.equal(
    formatTaskLogMessage({
      taskType: "system_claimhangupreward",
      status: "success",
      message: null,
    }),
    "执行成功：领取挂机奖励（system_claimhangupreward）",
  );
});

test("known and unknown game errors are expanded for reusable log displays", () => {
  assert.equal(
    explainLogError("[12400000] 挂机奖励领取过于频繁"),
    "挂机奖励领取过于频繁（错误码 12400000）",
  );
  assert.equal(
    explainLogError("[800040] 未知错误"),
    "游戏服务器未返回具体原因，请稍后重试并确认该操作状态（错误码 800040）",
  );
  assert.equal(
    formatLogMessage({
      task_type: "legacy_claimhangup",
      status: "error",
      message: "[12400000] 挂机奖励领取过于频繁",
    }),
    "执行失败：领取功法挂机奖励（legacy_claimhangup）；挂机奖励领取过于频繁（错误码 12400000）",
  );
});
