import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { loadModule } from "./helpers/loadModule.js";

const component = await readFile(
  new URL(
    "../src/components/Nightmare/NightmareConfigModal.vue",
    import.meta.url,
  ),
  "utf8",
);
const { sanitizeNightmareSettings, validateNightmareSettingsForUi } =
  await loadModule(new URL("../src/utils/nightmare.js", import.meta.url));

test("nightmare UI removes duplicate accounts inside and across teams", () => {
  const settings = sanitizeNightmareSettings({
    teams: [
      {
        id: "team-a",
        name: "队伍A",
        leaderTokenId: "a",
        mainTokenId: "a",
        members: [
          { tokenId: "a", formation: 1 },
          { tokenId: "b", formation: 2 },
          { tokenId: "b", formation: 3 },
          { tokenId: "c", formation: 4 },
        ],
        stages: [{ layer: 1, order: ["a", "b", "b", "c"] }],
      },
      {
        id: "team-b",
        name: "队伍B",
        leaderTokenId: "c",
        mainTokenId: "d",
        members: [
          { tokenId: "c", formation: 1 },
          { tokenId: "d", formation: 1 },
        ],
        stages: [{ layer: 1, order: ["c", "d"] }],
      },
    ],
  });
  assert.deepEqual(
    Array.from(settings.teams[0].members, (entry) => entry.tokenId),
    ["a", "b", "c"],
  );
  assert.deepEqual(Array.from(settings.teams[0].stages[0].order), [
    "a",
    "b",
    "c",
  ]);
  assert.deepEqual(
    Array.from(settings.teams[1].members, (entry) => entry.tokenId),
    ["d"],
  );
  assert.equal(settings.teams[1].leaderTokenId, "");
  assert.equal(settings.teams[1].mainTokenId, "d");
  assert.equal(
    validateNightmareSettingsForUi({ teams: [] }).join("|"),
    "至少创建一套十殿队伍",
  );
});

test("new team action is an inline plus and stage order tags are numbered", async () => {
  const runner = await readFile(
    new URL("../render-backend/lib/nightmareRunner.js", import.meta.url),
    "utf8",
  );
  assert.match(
    component,
    /<template #suffix>[\s\S]*<AddOutline \/>[\s\S]*<\/template>/,
  );
  assert.match(
    component,
    /n-tabs-nav-scroll-wrapper\)\s*\{\s*flex:\s*0 1 auto;/,
  );
  assert.match(component, /class="nightmare-add-team"/);
  assert.match(component, /padding-left:\s*var\(--n-tab-gap,\s*36px\)/);
  assert.match(component, /border-radius:\s*2px/);
  assert.match(component, /:render-tag="renderStageTag\(stage\)"/);
  assert.match(component, /stage-order-number/);
  assert.doesNotMatch(component, /抢符咒快速测试/);
  assert.doesNotMatch(component, /战斗命令由队长连接发送/);
  assert.doesNotMatch(runner, /战斗命令由队长连接发送/);
});
