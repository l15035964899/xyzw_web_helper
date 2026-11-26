<template>
  <n-modal
    v-model:show="visible"
    preset="card"
    title="十殿自动挑战配置"
    class="nightmare-modal"
  >
    <n-tabs
      v-model:value="activeTeamId"
      class="nightmare-tabs"
      type="line"
      animated
    >
      <template #suffix>
        <n-button
          class="nightmare-add-team"
          size="small"
          dashed
          aria-label="新增十殿队伍"
          title="新增十殿队伍"
          :disabled="draft.teams.length >= 3"
          @click="addTeam"
        >
          <n-icon><AddOutline /></n-icon>
        </n-button>
      </template>
      <n-tab-pane
        v-for="team in draft.teams"
        :key="team.id"
        :name="team.id"
        :tab="team.name || '未命名队伍'"
      >
        <n-space vertical size="large">
          <n-card size="small">
            <n-space align="center" justify="space-between">
              <n-space align="center">
                <n-input
                  v-model:value="team.name"
                  placeholder="队伍名称"
                  style="width: 180px"
                />
                <n-switch v-model:value="team.enabled">
                  <template #checked>启用</template>
                  <template #unchecked>停用</template>
                </n-switch>
              </n-space>
              <n-space align="center">
                <NTag
                  size="small"
                  :type="teamStatusTagType(team.id)"
                  :bordered="false"
                >
                  {{ teamStatusText(team.id) }}
                </NTag>
                <n-button
                  size="small"
                  :loading="preparingTeamId === team.id"
                  @click="prepareTeam(team)"
                >
                  {{ teamStatus(team.id)?.exists ? "校正队伍" : "创建队伍" }}
                </n-button>
                <n-button
                  size="small"
                  type="error"
                  secondary
                  :loading="disbandingTeamId === team.id"
                  @click="disbandTeam(team)"
                >
                  解散队伍
                </n-button>
                <n-button
                  size="small"
                  :loading="statusLoadingTeamId === team.id"
                  @click="refreshTeamStatus(team.id, true)"
                >
                  刷新状态
                </n-button>
                <n-button
                  size="small"
                  type="error"
                  secondary
                  :disabled="draft.teams.length <= 1"
                  @click="removeTeam(team.id)"
                >
                  删除队伍
                </n-button>
              </n-space>
            </n-space>
            <n-alert
              v-if="teamStatus(team.id)?.exists"
              type="warning"
              :bordered="false"
              style="margin-top: 10px"
            >
              游戏内队伍已存在（{{
                teamStatusText(team.id)
              }}）。开始挑战会复用该队伍，不会再次修改游戏预设阵容；如需调整阵容，请先在游戏中解散队伍，再重新创建。
            </n-alert>
          </n-card>

          <n-grid :cols="2" :x-gap="12" :y-gap="12" responsive="screen">
            <n-grid-item>
              <div class="field-label">队长</div>
              <n-select
                v-model:value="team.leaderTokenId"
                :options="memberOptions(team)"
                placeholder="选择队长"
                clearable
              />
            </n-grid-item>
            <n-grid-item>
              <div class="field-label">主力（唯一使用恢复）</div>
              <n-select
                v-model:value="team.mainTokenId"
                :options="memberOptions(team)"
                placeholder="选择主力"
                clearable
              />
            </n-grid-item>
          </n-grid>

          <div>
            <div class="section-title">队伍成员与阵容</div>
            <n-table :bordered="false" size="small">
              <thead>
                <tr>
                  <th>成员</th>
                  <th style="width: 130px">预设阵容</th>
                  <th style="width: 80px">操作</th>
                </tr>
              </thead>
              <tbody>
                <tr
                  v-for="(member, memberIndex) in team.members"
                  :key="`${team.id}-${memberIndex}`"
                >
                  <td>
                    <n-select
                      v-model:value="member.tokenId"
                      :options="memberSelectOptions(team, memberIndex)"
                      filterable
                      clearable
                      placeholder="选择 NAS 账号"
                      @update:value="onMemberChange(team)"
                    />
                  </td>
                  <td>
                    <n-select
                      v-model:value="member.formation"
                      :options="formationOptions"
                    />
                  </td>
                  <td>
                    <n-button
                      size="tiny"
                      tertiary
                      type="error"
                      :disabled="team.members.length <= 2"
                      @click="removeMember(team, memberIndex)"
                    >
                      移除
                    </n-button>
                  </td>
                </tr>
              </tbody>
            </n-table>
            <n-button
              size="small"
              dashed
              style="margin-top: 8px"
              :disabled="team.members.length >= 5"
              @click="team.members.push({ tokenId: '', formation: 1 })"
            >
              添加队员
            </n-button>
          </div>

          <div>
            <div class="section-title">第 1～8 层出战顺序</div>
            <div class="stage-grid">
              <div
                v-for="stage in team.stages"
                :key="`${team.id}-stage-${stage.layer}`"
                class="stage-row"
              >
                <span class="stage-label">第 {{ stage.layer }} 层</span>
                <n-select
                  v-model:value="stage.order"
                  multiple
                  filterable
                  :options="memberOptions(team)"
                  :render-tag="renderStageTag(stage)"
                  placeholder="按选择顺序作为首发和补刀顺序"
                />
              </div>
            </div>
          </div>

          <n-card size="small" title="执行选项">
            <n-space vertical>
              <n-space align="center">
                <n-switch v-model:value="team.fastMode" />
                <span>极速模式</span>
                <n-input-number
                  v-model:value="team.fastWaitSeconds"
                  :min="5"
                  :max="120"
                  :disabled="!team.fastMode"
                  style="width: 130px"
                />
                <span>秒后发送完成指令</span>
              </n-space>
              <n-space align="center">
                <n-switch v-model:value="team.crossWeek" />
                <span>跨周模式：第八层前暂停，周一 0 点后继续</span>
              </n-space>
              <n-space align="center">
                <span>最多重试次数</span>
                <n-input-number
                  v-model:value="team.maxRetries"
                  :min="0"
                  :max="2"
                  :precision="0"
                  style="width: 130px"
                />
                <span>
                  次（含首次共 {{ Number(team.maxRetries || 0) + 1 }} 次挑战；0
                  表示失败后不重试）
                </span>
              </n-space>
              <n-alert type="info" :bordered="false">
                失败后会从第一层重新开始；符咒只准备 1～6 层各 1
                张，重试不自动补符。
              </n-alert>
            </n-space>
          </n-card>

          <n-space>
            <n-button
              type="primary"
              :loading="saving"
              @click="saveDraft({ close: false })"
            >
              保存配置
            </n-button>
            <n-button
              type="warning"
              :loading="startingTeamId === team.id"
              @click="startTeam(team)"
            >
              开始挑战
            </n-button>
          </n-space>
        </n-space>
      </n-tab-pane>
    </n-tabs>

    <n-space justify="end" style="margin-top: 12px">
      <n-space>
        <n-button @click="visible = false">关闭</n-button>
        <n-button type="primary" :loading="saving" @click="saveDraft()">
          保存
        </n-button>
      </n-space>
    </n-space>
  </n-modal>
</template>

<script setup>
import { AddOutline } from "@vicons/ionicons5";
import { NTag, useDialog, useMessage } from "naive-ui";
import { computed, h, onBeforeUnmount, ref, watch } from "vue";
import {
  disbandNightmareTeam,
  loadNightmareTeamStatus,
  prepareNightmareTeam,
  saveNightmareSettings,
  startNightmareTeam,
} from "@/api/nightmare";
import { formationOptions } from "@/utils/batch/constants";
import {
  createEmptyNightmareTeam,
  defaultNightmareSettings,
  sanitizeNightmareSettings,
  validateNightmareSettingsForUi,
} from "@/utils/nightmare";

const props = defineProps({
  show: { type: Boolean, default: false },
  settings: { type: Object, default: () => defaultNightmareSettings },
  accounts: { type: Array, default: () => [] },
});
const emit = defineEmits(["update:show", "saved"]);
const message = useMessage();
const dialog = useDialog();

const draft = ref(sanitizeNightmareSettings(props.settings));
const activeTeamId = ref(draft.value.teams[0]?.id || "");
const saving = ref(false);
const preparingTeamId = ref("");
const startingTeamId = ref("");
const disbandingTeamId = ref("");
const teamStatuses = ref({});
const statusLoadingTeamId = ref("");
let statusTimer = null;

const visible = computed({
  get: () => props.show,
  set: (value) => emit("update:show", value),
});

const accountOptions = computed(() =>
  props.accounts.map((account) => ({
    label: `${account.name || account.id} (${account.id})`,
    value: String(account.id),
  })),
);

function memberOptions(team) {
  const selected = new Set(
    (team?.members || []).map((entry) => String(entry.tokenId || "")),
  );
  return accountOptions.value.filter((option) => selected.has(option.value));
}

function renderStageTag(stage) {
  return ({ option, handleClose }) => {
    const tokenId = String(option.value);
    const order = (stage.order || []).findIndex(
      (entry) => String(entry) === tokenId,
    );
    return h(
      NTag,
      {
        class: "stage-order-tag",
        size: "small",
        type: "info",
        bordered: false,
        closable: true,
        onClose: handleClose,
      },
      {
        default: () => [
          h("span", { class: "stage-order-number" }, String(order + 1)),
          h("span", { class: "stage-order-name" }, String(option.label || "")),
        ],
      },
    );
  };
}

function memberSelectOptions(team, memberIndex) {
  const occupied = new Set();
  team.members.forEach((member, index) => {
    if (index !== memberIndex && member.tokenId) {
      occupied.add(String(member.tokenId));
    }
  });
  for (const otherTeam of draft.value.teams) {
    if (otherTeam.id === team.id) continue;
    for (const member of otherTeam.members || []) {
      if (member.tokenId) occupied.add(String(member.tokenId));
    }
  }
  return accountOptions.value.filter(
    (option) =>
      !occupied.has(option.value) ||
      option.value === String(team.members[memberIndex]?.tokenId || ""),
  );
}

function onMemberChange(team) {
  const seen = new Set();
  for (const member of team.members) {
    const tokenId = String(member.tokenId || "");
    if (!tokenId) continue;
    if (seen.has(tokenId)) {
      member.tokenId = "";
      message.warning("同一账号不能在队伍中重复选择");
      continue;
    }
    seen.add(tokenId);
  }
  const available = new Set(
    team.members.map((entry) => String(entry.tokenId || "")).filter(Boolean),
  );
  if (!available.has(String(team.leaderTokenId || ""))) {
    team.leaderTokenId = "";
  }
  if (!available.has(String(team.mainTokenId || ""))) {
    team.mainTokenId = "";
  }
  for (const stage of team.stages) {
    stage.order = (stage.order || []).filter((id) => available.has(String(id)));
  }
}

function teamStatus(teamId) {
  return teamStatuses.value[String(teamId)] || null;
}

function teamStatusText(teamId) {
  const status = teamStatus(teamId);
  if (!status) return "未查询";
  if (status.loading) return "查询中";
  if (status.error) return "查询失败";
  if (status.autoDisbanded) return "主力已离队，队伍已自动解散";
  if (status.status === "team") {
    return `已组队 ${status.memberCount || 0} 人，准备 ${status.preparedCount || 0} 人`;
  }
  if (status.status === "ready") {
    return `已组队并准备 ${status.memberCount || 0} 人`;
  }
  return (
    {
      none: "未组队",
      challenge: "已进入挑战房间",
      running: "自动任务运行中",
      busy: "账号占用中",
    }[status.status] ||
    status.message ||
    "未知状态"
  );
}

function teamStatusTagType(teamId) {
  const status = teamStatus(teamId)?.status;
  if (status === "ready" || status === "challenge") return "success";
  if (status === "running" || status === "busy") return "warning";
  if (status === "none") return "default";
  if (teamStatus(teamId)?.error) return "error";
  return "info";
}

async function refreshTeamStatus(teamId, force = false) {
  const id = String(teamId || "");
  if (!id || (statusLoadingTeamId.value === id && !force)) return;
  statusLoadingTeamId.value = id;
  try {
    const status = await loadNightmareTeamStatus(id, { refresh: force });
    teamStatuses.value = {
      ...teamStatuses.value,
      [id]: status,
    };
  } catch (error) {
    teamStatuses.value = {
      ...teamStatuses.value,
      [id]: {
        status: "error",
        error: error.message,
        checkedAt: new Date().toISOString(),
      },
    };
  } finally {
    if (statusLoadingTeamId.value === id) statusLoadingTeamId.value = "";
  }
}

function startStatusPolling() {
  if (statusTimer) clearInterval(statusTimer);
  refreshTeamStatus(activeTeamId.value);
  statusTimer = setInterval(() => {
    if (visible.value && activeTeamId.value) {
      refreshTeamStatus(activeTeamId.value);
    }
  }, 120_000);
}

function stopStatusPolling() {
  if (statusTimer) clearInterval(statusTimer);
  statusTimer = null;
}

function addTeam() {
  if (draft.value.teams.length >= 3) return;
  const team = createEmptyNightmareTeam(draft.value.teams.length);
  draft.value.teams.push(team);
  activeTeamId.value = team.id;
}

function removeTeam(teamId) {
  if (draft.value.teams.length <= 1) return;
  draft.value.teams = draft.value.teams.filter((team) => team.id !== teamId);
  if (activeTeamId.value === teamId) {
    activeTeamId.value = draft.value.teams[0]?.id || "";
  }
}

function removeMember(team, index) {
  if (team.members.length <= 2) return;
  team.members.splice(index, 1);
  onMemberChange(team);
}

function normalizedDraft() {
  const value = sanitizeNightmareSettings(draft.value);
  for (const team of value.teams) {
    for (const stage of team.stages) {
      stage.order = [...new Set((stage.order || []).map(String))];
    }
  }
  return value;
}

async function persist() {
  const value = normalizedDraft();
  const errors = validateNightmareSettingsForUi(value);
  if (errors.length > 0) {
    message.error(errors.slice(0, 3).join("；"));
    return null;
  }
  saving.value = true;
  try {
    const saved = await saveNightmareSettings(value);
    draft.value = sanitizeNightmareSettings(saved.nightmare);
    emit("saved", saved.nightmare);
    await refreshTeamStatus(activeTeamId.value, true);
    message.success("十殿配置已保存到 NAS");
    return saved.nightmare;
  } catch (error) {
    message.error(`保存十殿配置失败：${error.message}`);
    return null;
  } finally {
    saving.value = false;
  }
}

async function saveDraft({ close = true } = {}) {
  const settings = await persist();
  if (settings && close) visible.value = false;
}

async function prepareTeam(team) {
  if (!(await persist())) return;
  preparingTeamId.value = team.id;
  try {
    const result = await prepareNightmareTeam(team.id);
    teamStatuses.value = {
      ...teamStatuses.value,
      [team.id]: {
        status: "team",
        exists: true,
        checkedAt: new Date().toISOString(),
      },
    };
    await refreshTeamStatus(team.id, true);
    message.success(
      `队伍准备完成：${(result.activeTokenIds || []).length} 个可用成员`,
    );
  } catch (error) {
    message.error(`准备队伍失败：${error.message}`);
  } finally {
    preparingTeamId.value = "";
  }
}

async function startTeam(team) {
  if (!(await persist())) return;
  startingTeamId.value = team.id;
  try {
    await startNightmareTeam(team.id);
    await refreshTeamStatus(team.id, true);
    message.success("自动十殿已在 NAS 启动，请查看任务日志");
  } catch (error) {
    message.error(`启动自动十殿失败：${error.message}`);
  } finally {
    startingTeamId.value = "";
  }
}

function disbandTeam(team) {
  dialog.warning({
    title: "解散十殿队伍",
    content: `确定解散“${team.name || team.id}”当前在游戏中的队伍吗？解散后所有成员会切换回各自配置的竞技场阵容。`,
    positiveText: "解散",
    negativeText: "取消",
    onPositiveClick: async () => {
      disbandingTeamId.value = team.id;
      try {
        const result = await disbandNightmareTeam(team.id);
        await refreshTeamStatus(team.id, true);
        message.success(
          result.alreadyDisbanded
            ? "游戏内队伍已经解散，竞技场阵容已校验"
            : "十殿队伍已解散，所有成员已恢复竞技场阵容",
        );
      } catch (error) {
        message.error(`解散队伍失败：${error.message}`);
      } finally {
        disbandingTeamId.value = "";
      }
    },
  });
}

watch(
  () => props.show,
  (show) => {
    if (!show) {
      stopStatusPolling();
      return;
    }
    draft.value = sanitizeNightmareSettings(props.settings);
    activeTeamId.value = draft.value.teams[0]?.id || "";
    startStatusPolling();
  },
);

watch(activeTeamId, (teamId) => {
  if (visible.value && teamId) refreshTeamStatus(teamId);
});

onBeforeUnmount(stopStatusPolling);
</script>

<style scoped>
.nightmare-modal {
  width: min(1120px, 94vw);
}

.nightmare-tabs :deep(.n-tabs-nav-scroll-wrapper) {
  flex: 0 1 auto;
}

.nightmare-tabs :deep(.n-tabs-nav__suffix) {
  padding-left: var(--n-tab-gap, 36px);
}

.nightmare-tabs :deep(.n-tabs-nav__suffix .n-button) {
  flex: none;
  width: 28px;
  height: 28px;
  padding: 0;
  border-radius: 2px;
}

.field-label,
.section-title {
  margin-bottom: 6px;
  font-size: 13px;
  font-weight: 600;
  color: var(--text-primary, #333);
}

.section-title {
  margin-top: 4px;
  font-size: 14px;
}

.stage-grid {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 10px;
}

.stage-row {
  display: grid;
  grid-template-columns: 72px minmax(0, 1fr);
  align-items: center;
  gap: 8px;
  padding: 8px;
  border: 1px solid var(--border-light, #e8e8e8);
  border-radius: 6px;
}

.stage-label {
  font-size: 12px;
  color: var(--text-secondary, #666);
}

:deep(.stage-order-tag) {
  height: 26px;
  padding: 0 8px;
  border-radius: 13px;
}

:deep(.stage-order-tag .n-tag__content) {
  display: inline-flex;
  align-items: center;
  gap: 6px;
}

:deep(.stage-order-number) {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 17px;
  height: 17px;
  border-radius: 50%;
  background: var(--primary-color, #18a058);
  color: #fff;
  font-size: 11px;
  font-weight: 700;
  line-height: 17px;
}

:deep(.stage-order-name) {
  max-width: 210px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

@media (max-width: 720px) {
  .stage-grid {
    grid-template-columns: 1fr;
  }
}
</style>
