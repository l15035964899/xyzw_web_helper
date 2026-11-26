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
  assert.equal(
    formatTaskLogMessage({
      taskType: "taskCompleted",
      status: "success",
      message: "已完成日常任务",
    }),
    "执行成功：定时任务完成（taskCompleted）；已完成日常任务",
  );
});

test("known and unknown game errors are expanded for reusable log displays", () => {
  assert.equal(
    explainLogError("[12400000] 挂机奖励领取过于频繁"),
    "挂机奖励领取过于频繁（错误码 12400000）",
  );
  assert.equal(
    explainLogError("[12400160] 未知错误"),
    "请先开始功法残卷收集（错误码 12400160）",
  );
  assert.equal(
    explainLogError("[800040] 未知错误"),
    "没有可领取的挂机奖励（错误码 800040）",
  );
  assert.equal(
    explainLogError("[200750] 未知错误"),
    "战斗版本已失效，请刷新战斗数据后重试（错误码 200750）",
  );
  assert.equal(
    formatLogMessage({
      task_type: "legacy_claimhangup",
      status: "error",
      message: "[12400000] 挂机奖励领取过于频繁",
    }),
    "执行失败：领取功法挂机奖励（legacy_claimhangup）；挂机奖励领取过于频繁（错误码 12400000）",
  );
  assert.equal(
    formatLogMessage({
      task_type: "legacy_beginhangup",
      status: "success",
      message: null,
    }),
    "执行成功：开始收集功法残卷（legacy_beginhangup）",
  );
});
