<template>
  <main class="server-page">
    <header class="page-head">
      <div>
        <h1>服务器挂机</h1>
        <p>
          任务由当前 NAS 服务端 7×24
          执行。关闭浏览器、电脑或手机不会影响已经启用的 Cron 任务。
        </p>
      </div>
      <n-tag :type="connectionTagType" round>{{ connectionText }}</n-tag>
    </header>

    <n-alert
      v-if="errorMessage"
      type="error"
      closable
      @close="errorMessage = ''"
    >
      {{ errorMessage }}
    </n-alert>

    <section class="panel">
      <div class="panel-title">
        <div>
          <h2>连接</h2>
          <p>默认连接当前 NAS 地址。同源访问时 API Key 可以留空。</p>
        </div>
        <n-button type="primary" :loading="loading" @click="connect">
          连接并刷新
        </n-button>
      </div>
      <div class="connection-grid">
        <n-input
          v-model:value="connection.baseUrl"
          placeholder="留空表示当前站点；例如 http://192.168.0.222:3002"
        />
        <n-input
          v-model:value="connection.apiKey"
          type="password"
          show-password-on="click"
          placeholder="可选：服务器 .env 中的 API_KEY"
        />
      </div>
    </section>

    <section class="panel">
      <div class="panel-title">
        <div>
          <h2>账号（{{ accounts.length }}）</h2>
          <p>账号和 Token 保存在 NAS 的持久化数据目录中。</p>
        </div>
        <n-space>
          <input
            ref="backupInput"
            class="hidden-input"
            type="file"
            accept=".json,application/json"
            @change="importBackup"
          />
          <n-button @click="backupInput?.click()">导入完整备份</n-button>
          <n-button
            :disabled="!tokenStore.gameTokens.length"
            :loading="saving"
            @click="syncLocalAccounts"
          >
            同步本机账号和设置
          </n-button>
          <n-button :disabled="!accounts.length" @click="syncAccountsToLocal">
            同步到本机
          </n-button>
          <n-button type="primary" @click="manualAccountVisible = true">
            手动添加
          </n-button>
        </n-space>
      </div>

      <div class="table-wrap">
        <table>
          <thead>
            <tr>
              <th>名称</th>
              <th>roleId</th>
              <th>区服</th>
              <th>状态</th>
              <th class="actions">操作</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="account in accounts" :key="account.id">
              <td>{{ account.name }}</td>
              <td>{{ account.roleId || account.role_id || "-" }}</td>
              <td>{{ account.server || "-" }}</td>
              <td>
                <n-tag
                  :type="account.enabled ? 'success' : 'default'"
                  size="small"
                >
                  {{ account.enabled ? "启用" : "停用" }}
                </n-tag>
              </td>
              <td class="actions">
                <n-button
                  size="small"
                  type="primary"
                  secondary
                  @click="openAccountSettings(account)"
                >
                  设置
                </n-button>
                <n-button
                  size="small"
                  type="primary"
                  secondary
                  @click="toggleAccount(account)"
                >
                  {{ account.enabled ? "停用" : "启用" }}
                </n-button>
                <n-button
                  size="small"
                  type="error"
                  secondary
                  @click="deleteAccount(account)"
                >
                  删除
                </n-button>
              </td>
            </tr>
            <tr v-if="!accounts.length">
              <td colspan="5" class="empty-cell">服务器上还没有账号</td>
            </tr>
          </tbody>
        </table>
      </div>
    </section>

    <section class="panel">
      <div class="panel-title">
        <div>
          <h2>定时任务（{{ tasks.length }}）</h2>
          <p>启用后由 NAS 服务端注册 Cron，不依赖浏览器页面。</p>
        </div>
        <n-space>
          <n-button :loading="taskRefreshing" @click="refreshTasks">
            刷新
          </n-button>
          <n-button type="primary" @click="openTaskDialog()">新增任务</n-button>
        </n-space>
      </div>

      <div class="table-wrap">
        <table>
          <thead>
            <tr>
              <th>名称</th>
              <th>Cron</th>
              <th>包含任务</th>
              <th>账号数</th>
              <th>上次运行</th>
              <th>下次运行（上海时间）</th>
              <th class="actions">操作</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="task in sortedTasks" :key="task.id">
              <td>
                {{ task.name }}
                <n-tag v-if="!task.enabled" size="tiny">停用</n-tag>
              </td>
              <td>
                <code>{{ cronExpression(task) }}</code>
              </td>
              <td>{{ taskNames(task).join("、") || "-" }}</td>
              <td>{{ selectedTokenIds(task).length }}</td>
              <td>{{ formatDate(task.last_run_at) }}</td>
              <td>{{ nextRunText(task) }}</td>
              <td class="actions">
                <n-button
                  size="small"
                  type="primary"
                  secondary
                  @click="runTask(task)"
                >
                  立刻执行
                </n-button>
                <n-button
                  size="small"
                  type="primary"
                  secondary
                  @click="openTaskDialog(task)"
                >
                  编辑
                </n-button>
                <n-button
                  size="small"
                  type="error"
                  secondary
                  @click="deleteTask(task)"
                >
                  删除
                </n-button>
              </td>
            </tr>
            <tr v-if="!tasks.length">
              <td colspan="7" class="empty-cell">还没有服务器定时任务</td>
            </tr>
          </tbody>
        </table>
      </div>
    </section>

    <section class="panel">
      <div class="panel-title">
        <div>
          <h2>执行日志</h2>
          <p>服务端任务执行后写入 NAS 本地日志文件。</p>
        </div>
        <n-space align="center">
          <n-checkbox v-model:checked="autoRefresh">自动刷新（10s）</n-checkbox>
          <n-button :loading="logLoading" @click="loadLogs">刷新</n-button>
        </n-space>
      </div>

      <div class="table-wrap logs">
        <table>
          <thead>
            <tr>
              <th>时间</th>
              <th>级别</th>
              <th>分类</th>
              <th>内容</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="entry in logs" :key="entry.id || entry.created_at">
              <td>{{ formatDate(entry.created_at, true) }}</td>
              <td>
                <n-tag
                  size="small"
                  :type="
                    entry.status === 'success'
                      ? 'success'
                      : entry.status === 'error'
                        ? 'error'
                        : 'default'
                  "
                >
                  {{ String(entry.status || "info").toUpperCase() }}
                </n-tag>
              </td>
              <td class="log-category">
                <div>{{ taskTypeLabel(entry.task_type) }}</div>
                <code>{{ entry.task_type || "-" }}</code>
              </td>
              <td>
                <span v-if="entry.token_name" class="log-account">
                  {{ entry.token_name }}
                </span>
                {{ formatLogMessage(entry) }}
              </td>
            </tr>
            <tr v-if="!logs.length">
              <td colspan="4" class="empty-cell">暂无执行日志</td>
            </tr>
          </tbody>
        </table>
      </div>
    </section>

    <n-modal v-model:show="manualAccountVisible">
      <n-card class="dialog-card" title="手动添加服务器账号">
        <n-space vertical>
          <n-input v-model:value="manualAccount.name" placeholder="账号名称" />
          <n-input
            v-model:value="manualAccount.token"
            type="textarea"
            :rows="7"
            placeholder="粘贴 Token，支持 JSON 或 Base64 JSON"
          />
          <n-space justify="end">
            <n-button @click="manualAccountVisible = false">取消</n-button>
            <n-button
              type="primary"
              :loading="saving"
              @click="addManualAccount"
            >
              添加
            </n-button>
          </n-space>
        </n-space>
      </n-card>
    </n-modal>

    <n-modal v-model:show="accountSettingsVisible">
      <n-card
        class="account-settings-dialog"
        :title="`账号任务设置 - ${accountSettingsAccount?.name || ''}`"
      >
        <n-space vertical :size="16">
          <div class="account-settings-grid">
            <div class="field">
              <label>竞技场阵容</label>
              <n-select
                v-model:value="accountSettings.arenaFormation"
                :options="formationOptions"
              />
            </div>
            <div class="field">
              <label>爬塔阵容</label>
              <n-select
                v-model:value="accountSettings.towerFormation"
                :options="formationOptions"
              />
            </div>
            <div class="field">
              <label>BOSS阵容</label>
              <n-select
                v-model:value="accountSettings.bossFormation"
                :options="formationOptions"
              />
            </div>
            <div class="field">
              <label>BOSS次数</label>
              <n-select
                v-model:value="accountSettings.bossTimes"
                :options="bossTimesOptions"
              />
            </div>
          </div>

          <div class="settings-switches">
            <label>
              <span>领罐子</span>
              <n-switch v-model:value="accountSettings.claimBottle" />
            </label>
            <label>
              <span>领挂机</span>
              <n-switch v-model:value="accountSettings.claimHangUp" />
            </label>
            <label>
              <span>竞技场</span>
              <n-switch v-model:value="accountSettings.arenaEnable" />
            </label>
            <label>
              <span>开宝箱</span>
              <n-switch v-model:value="accountSettings.openBox" />
            </label>
            <label>
              <span>领取邮件奖励</span>
              <n-switch v-model:value="accountSettings.claimEmail" />
            </label>
            <label>
              <span>黑市购买物品</span>
              <n-switch v-model:value="accountSettings.blackMarketPurchase" />
            </label>
            <label>
              <span>付费招募</span>
              <n-switch v-model:value="accountSettings.payRecruit" />
            </label>
          </div>

          <n-space justify="end">
            <n-button @click="accountSettingsVisible = false">取消</n-button>
            <n-button
              type="primary"
              :loading="saving"
              @click="saveAccountSettings"
            >
              保存设置
            </n-button>
          </n-space>
        </n-space>
      </n-card>
    </n-modal>

    <n-modal v-model:show="taskDialogVisible">
      <n-card
        class="dialog-card task-dialog"
        :title="taskDraft.id ? '编辑定时任务' : '新增定时任务'"
      >
        <n-space vertical :size="16">
          <div class="field">
            <label>任务名称</label>
            <n-input
              v-model:value="taskDraft.name"
              placeholder="例如：每日一键日常"
            />
          </div>

          <div class="field">
            <label>Cron 表达式</label>
            <n-input
              v-model:value="taskDraft.cron_expr"
              placeholder="0 8 * * *"
            />
            <div class="presets">
              <n-button
                v-for="preset in cronPresets"
                :key="preset.expr"
                size="small"
                @click="taskDraft.cron_expr = preset.expr"
              >
                {{ preset.label }}
              </n-button>
            </div>
          </div>

          <div class="field">
            <div class="field-title-row">
              <label>包含任务</label>
              <n-space size="small">
                <n-button size="small" @click="selectAllTasks">全选</n-button>
                <n-button size="small" @click="taskDraft.selected_tasks = []">
                  全不选
                </n-button>
              </n-space>
            </div>
            <n-tabs
              type="line"
              animated
              size="small"
              default-value="daily"
              pane-style="padding-top: 12px;"
            >
              <n-tab-pane
                v-for="group in taskGroups"
                :key="group.key"
                :name="group.key"
                :tab="group.label"
              >
                <div class="check-grid task-types">
                  <label
                    v-for="definition in groupedDefinitions[group.key] || []"
                    :key="definition.key"
                    class="check-item"
                    :title="definition.description"
                  >
                    <input
                      type="checkbox"
                      :checked="
                        taskDraft.selected_tasks.includes(definition.key)
                      "
                      @change="
                        toggleDraftValue('selected_tasks', definition.key)
                      "
                    />
                    <span>{{ definition.name }}</span>
                  </label>
                </div>
              </n-tab-pane>
            </n-tabs>
          </div>

          <div v-if="selectedOptionDefinitions.length" class="field">
            <label>任务参数</label>
            <n-card
              v-for="definition in selectedOptionDefinitions"
              :key="definition.key"
              size="small"
              :title="definition.name"
              class="task-option-card"
            >
              <div class="option-grid">
                <div
                  v-for="option in definition.options"
                  :key="`${definition.key}:${option.key}`"
                  class="option-field"
                >
                  <label>
                    {{ option.label }}
                    <span v-if="option.required" class="required">*</span>
                  </label>
                  <n-select
                    v-if="option.type === 'select'"
                    v-model:value="taskDraft.options[option.key]"
                    :options="option.options || []"
                  />
                  <n-input-number
                    v-else-if="option.type === 'number'"
                    v-model:value="taskDraft.options[option.key]"
                    :min="option.min"
                    :max="option.max"
                    clearable
                  />
                  <n-button
                    v-else-if="option.type === 'dream-items'"
                    type="primary"
                    secondary
                    @click="openDreamConfig"
                  >
                    选择梦境商品（{{ selectedDreamCount }} 项）
                  </n-button>
                  <n-input
                    v-else
                    v-model:value="taskDraft.options[option.key]"
                    :placeholder="option.placeholder || ''"
                    :rows="option.type === 'textarea' ? 3 : undefined"
                    :autosize="
                      option.type === 'textarea'
                        ? { minRows: 3, maxRows: 8 }
                        : undefined
                    "
                    :show-password-on="
                      option.type === 'password' ? 'click' : undefined
                    "
                    :type="
                      option.type === 'textarea'
                        ? 'textarea'
                        : option.type === 'password'
                          ? 'password'
                          : 'text'
                    "
                  />
                </div>
              </div>
            </n-card>
          </div>

          <div class="field">
            <label>执行账号</label>
            <div class="check-grid">
              <label
                v-for="account in accounts"
                :key="account.id"
                class="check-item"
              >
                <input
                  type="checkbox"
                  :checked="taskDraft.selected_tokens.includes(account.id)"
                  @change="toggleDraftValue('selected_tokens', account.id)"
                />
                <span>{{ account.name }}</span>
                <n-button
                  text
                  size="tiny"
                  class="account-settings-button"
                  @click.prevent.stop="openAccountSettings(account)"
                >
                  设置
                </n-button>
              </label>
            </div>
          </div>

          <label class="switch-row">
            <span>启用自动执行</span>
            <n-switch v-model:value="taskDraft.enabled" />
          </label>

          <n-alert type="info" :bordered="false">
            时区固定为 Asia/Shanghai。例如“0 */5 * * *”表示每 5 小时整点执行。
          </n-alert>

          <n-space justify="end">
            <n-button @click="taskDialogVisible = false">取消</n-button>
            <n-button type="primary" :loading="saving" @click="saveTask">
              保存任务
            </n-button>
          </n-space>
        </n-space>
      </n-card>
    </n-modal>

    <n-modal
      v-model:show="dreamConfigVisible"
      preset="card"
      title="梦境商品购买配置"
      class="dream-config-modal"
    >
      <n-space vertical :size="16">
        <n-alert type="info" show-icon>
          请勾选需要购买的商品。只会购买列表中存在的商品。
        </n-alert>

        <n-space>
          <n-button type="warning" @click="selectGoldDreamItems">
            一键勾选金币商品
          </n-button>
          <n-button @click="selectAllDreamItems">全选所有</n-button>
          <n-button @click="dreamConfigDraft = []">清空选择</n-button>
        </n-space>

        <div
          v-for="(merchant, merchantId) in merchantConfig"
          :key="merchantId"
          class="merchant-group"
        >
          <h3>{{ merchant.name }}</h3>
          <n-grid :cols="3" :x-gap="12" :y-gap="10">
            <n-grid-item
              v-for="(item, itemIndex) in merchant.items"
              :key="`${merchantId}-${itemIndex}`"
            >
              <n-checkbox
                :checked="
                  dreamConfigDraft.includes(`${merchantId}-${itemIndex}`)
                "
                @update:checked="
                  (checked) =>
                    toggleDreamDraftItem(`${merchantId}-${itemIndex}`, checked)
                "
              >
                {{ item }}
              </n-checkbox>
            </n-grid-item>
          </n-grid>
        </div>

        <n-space justify="end">
          <n-button @click="dreamConfigVisible = false">取消</n-button>
          <n-button type="primary" @click="saveDreamConfig">
            保存配置
          </n-button>
        </n-space>
      </n-space>
    </n-modal>
  </main>
</template>

<script setup>
import { useDialog, useMessage } from "naive-ui";
import {
  computed,
  onBeforeUnmount,
  onMounted,
  reactive,
  ref,
  watch,
} from "vue";
import {
  loadServerConnection,
  saveServerConnection,
  serverRequest,
} from "@/api/serverTasks";
import { useTokenStore } from "@/stores/tokenStore";
import { formatCronRun, getNextCronRun } from "@/utils/cronNextRun";
import { goldItemsConfig, merchantConfig } from "@/utils/dreamConstants";
import { formatLogMessage, taskTypeLabel } from "@/utils/serverTaskLog";
import { createBrowserTokenValue } from "@/utils/serverTaskToken";
import { syncLocalTokensToServer } from "@/utils/serverTokenSync";

const message = useMessage();
const dialog = useDialog();
const tokenStore = useTokenStore();
const connection = reactive(loadServerConnection());
const accounts = ref([]);
const tasks = ref([]);
const definitions = ref([]);
const logs = ref([]);
const loading = ref(false);
const logLoading = ref(false);
const taskRefreshing = ref(false);
const saving = ref(false);
const connectionState = ref("idle");
const errorMessage = ref("");
const autoRefresh = ref(false);
const backupInput = ref(null);
const manualAccountVisible = ref(false);
const taskDialogVisible = ref(false);
const dreamConfigVisible = ref(false);
const dreamConfigDraft = ref([]);
const accountSettingsVisible = ref(false);
const accountSettingsAccount = ref(null);
const manualAccount = reactive({ name: "", token: "" });
let autoRefreshTimer = null;
let nextRunTimer = null;
const clockTick = ref(Date.now());

const cronPresets = [
  { label: "每天 08:00", expr: "0 8 * * *" },
  { label: "每天 08:00 + 20:00", expr: "0 8,20 * * *" },
  { label: "每 5 小时", expr: "0 */5 * * *" },
  { label: "每 6 小时", expr: "0 */6 * * *" },
  { label: "每小时", expr: "0 * * * *" },
];

const taskGroups = [
  { key: "daily", label: "日常" },
  { key: "dungeon", label: "副本" },
  { key: "baoku", label: "宝库" },
  { key: "weirdTower", label: "怪异塔" },
  { key: "resource", label: "资源" },
  { key: "legacy", label: "功法" },
  { key: "monthly", label: "月度" },
];

const formationOptions = [1, 2, 3, 4, 5, 6].map((value) => ({
  label: `阵容${value}`,
  value,
}));
const bossTimesOptions = [0, 1, 2, 3, 4].map((value) => ({
  label: `${value}次`,
  value,
}));
const accountSettings = reactive(defaultAccountSettings());

const legacyTaskAliases = {
  dailyBundle: "startBatch",
  claimHangup: "claimHangUpRewards",
  arenaFight: "batcharenafight",
  legionSignIn: "batchclubsign",
};

const groupedDefinitions = computed(() =>
  Object.fromEntries(
    taskGroups.map((group) => [
      group.key,
      definitions.value.filter(
        (definition) => (definition.group || "other") === group.key,
      ),
    ]),
  ),
);

const selectedOptionDefinitions = computed(() =>
  definitions.value.filter(
    (definition) =>
      taskDraft.selected_tasks.includes(definition.key) &&
      definition.options?.length,
  ),
);

const selectedDreamCount = computed(
  () => normalizeDreamSelection(taskDraft.options.dreamPurchaseList).length,
);

const sortedTasks = computed(() =>
  [...tasks.value].sort((left, right) => {
    const leftNext = nextRunDate(left);
    const rightNext = nextRunDate(right);
    if (leftNext && rightNext) {
      const difference = leftNext.getTime() - rightNext.getTime();
      if (difference) return difference;
    } else if (leftNext) {
      return -1;
    } else if (rightNext) {
      return 1;
    }
    return left.name.localeCompare(right.name, "zh-CN");
  }),
);

const connectionText = computed(() => {
  if (loading.value) return "正在连接";
  if (connectionState.value === "ok") return "NAS 已连接";
  if (connectionState.value === "fail") return "连接失败";
  return "未连接";
});

const connectionTagType = computed(() => {
  if (connectionState.value === "ok") return "success";
  if (connectionState.value === "fail") return "error";
  return "default";
});

const taskDraft = reactive(emptyTask());

function emptyTask() {
  return {
    id: "",
    name: "",
    cron_expr: "0 8 * * *",
    selected_tasks: [],
    selected_tokens: [],
    options: {},
    enabled: true,
  };
}

function defaultAccountSettings() {
  return {
    arenaFormation: 1,
    towerFormation: 1,
    bossFormation: 1,
    bossTimes: 2,
    claimBottle: true,
    payRecruit: true,
    openBox: true,
    arenaEnable: true,
    claimHangUp: true,
    claimEmail: true,
    blackMarketPurchase: true,
  };
}

function request(path, options = {}) {
  return serverRequest(path, { ...connection, ...options });
}

async function connect() {
  loading.value = true;
  errorMessage.value = "";
  saveServerConnection(connection);
  try {
    await Promise.all([loadAccounts(), loadTasks(), loadDefinitions()]);
    await loadLogs();
    connectionState.value = "ok";
    message.success("NAS 服务已连接");
  } catch (error) {
    connectionState.value = "fail";
    errorMessage.value = error.message || String(error);
  } finally {
    loading.value = false;
  }
}

async function loadAccounts() {
  const data = await request("/api/tokens");
  accounts.value = Array.isArray(data) ? data : [];
}

async function loadTasks() {
  const data = await request("/api/tasks");
  tasks.value = Array.isArray(data) ? data : [];
}

async function refreshTasks() {
  taskRefreshing.value = true;
  try {
    await Promise.all([loadTasks(), loadDefinitions()]);
    clockTick.value = Date.now();
    message.success("定时任务已刷新");
  } catch (error) {
    message.error(`刷新定时任务失败：${error.message}`);
  } finally {
    taskRefreshing.value = false;
  }
}

async function loadDefinitions() {
  const data = await request("/api/task-definitions");
  definitions.value = Array.isArray(data) ? data : [];
}

async function loadLogs() {
  logLoading.value = true;
  try {
    const data = await request("/api/logs/db?limit=100");
    logs.value = Array.isArray(data) ? data : [];
  } catch (error) {
    console.error("加载日志失败", error);
  } finally {
    logLoading.value = false;
  }
}

function normalizeArray(value) {
  if (Array.isArray(value)) return value;
  if (typeof value !== "string") return [];
  try {
    const parsed = JSON.parse(value);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function normalizeTaskOptions(value) {
  if (value && typeof value === "object" && !Array.isArray(value)) {
    return { ...value };
  }
  if (typeof value !== "string" || !value.trim()) return {};
  try {
    const parsed = JSON.parse(value);
    return parsed && typeof parsed === "object" && !Array.isArray(parsed)
      ? parsed
      : {};
  } catch {
    return {};
  }
}

function normalizeDreamSelection(value) {
  const list = Array.isArray(value)
    ? value
    : String(value || "")
        .split(/[\s,，;；]+/)
        .filter(Boolean);
  return [
    ...new Set(
      list
        .map((item) => String(item).trim())
        .filter((item) => /^[1-3]-\d+$/.test(item)),
    ),
  ];
}

function selectedTokenIds(task) {
  return normalizeArray(task.selected_tokens || task.token_ids);
}

function normalizeSelectedTaskKeys(task) {
  return normalizeArray(task.selected_tasks || task.task_type).map(
    (key) => legacyTaskAliases[key] || key,
  );
}

function cronExpression(task) {
  return task.cron_expr || task.cron_expression || "-";
}

function nextRunDate(task) {
  if (!task.enabled) return null;
  return getNextCronRun(cronExpression(task), {
    now: new Date(clockTick.value),
    timeZone: "Asia/Shanghai",
  });
}

function nextRunText(task) {
  if (!task.enabled) return "已停用";
  const next = nextRunDate(task);
  return next ? formatCronRun(next) : "无法计算";
}

function taskNames(task) {
  const keys = normalizeArray(task.selected_tasks || task.task_type);
  return keys.map(
    (key) => definitions.value.find((item) => item.key === key)?.name || key,
  );
}

function formatDate(value, timeOnly = false) {
  if (!value) return "从未";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return String(value);
  return timeOnly ? date.toLocaleTimeString() : date.toLocaleString();
}

async function toggleAccount(account) {
  try {
    await request(`/api/tokens/${encodeURIComponent(account.id)}`, {
      method: "PATCH",
      body: { enabled: !account.enabled },
    });
    await loadAccounts();
  } catch (error) {
    message.error(error.message);
  }
}

function openAccountSettings(account) {
  accountSettingsAccount.value = account;
  Object.assign(
    accountSettings,
    defaultAccountSettings(),
    normalizeTaskOptions(account.daily_settings),
  );
  accountSettingsVisible.value = true;
}

async function saveAccountSettings() {
  const account = accountSettingsAccount.value;
  if (!account) return;
  saving.value = true;
  try {
    const settings = { ...accountSettings };
    const [updated] = await request(
      `/api/tokens/${encodeURIComponent(account.id)}`,
      {
        method: "PATCH",
        body: { daily_settings: settings },
      },
    );
    Object.assign(account, updated || { daily_settings: settings });
    const localToken = tokenStore.gameTokens.find(
      (token) => String(token.roleId) === String(account.roleId),
    );
    if (localToken) {
      localStorage.setItem(
        `daily-settings:${localToken.id}`,
        JSON.stringify(settings),
      );
    }
    accountSettingsVisible.value = false;
    message.success(`已保存 ${account.name} 的账号配置`);
  } catch (error) {
    message.error(`保存账号配置失败：${error.message}`);
  } finally {
    saving.value = false;
  }
}

function deleteAccount(account) {
  dialog.warning({
    title: "删除服务器账号",
    content: `确定删除“${account.name}”吗？`,
    positiveText: "删除",
    negativeText: "取消",
    onPositiveClick: async () => {
      try {
        await request(`/api/tokens/${encodeURIComponent(account.id)}`, {
          method: "DELETE",
        });
        await loadAccounts();
        message.success("账号已删除");
      } catch (error) {
        message.error(error.message);
      }
    },
  });
}

function decodeTokenPayload(raw) {
  const value = String(raw || "").trim();
  if (!value) throw new Error("Token 不能为空");
  const direct = tryJson(value);
  if (direct?.roleToken) return normalizeTokenPayload(direct);

  const unwrapped = value.replace(/^["']|["']$/g, "");
  for (const candidate of [
    unwrapped,
    unwrapped.replace(/-/g, "+").replace(/_/g, "/"),
    unwrapped.split("").reverse().join(""),
  ]) {
    const padded = candidate.padEnd(
      candidate.length + ((4 - (candidate.length % 4)) % 4),
      "=",
    );
    try {
      const decoded = JSON.parse(atob(padded));
      if (decoded?.roleToken) return normalizeTokenPayload(decoded);
    } catch {
      // Try the next supported encoding.
    }
  }
  return normalizeTokenPayload({ roleToken: value });
}

function tryJson(value) {
  try {
    return JSON.parse(value);
  } catch {
    return null;
  }
}

function normalizeTokenPayload(value) {
  return {
    roleToken: value.roleToken,
    roleId: value.roleId ?? null,
    sessId: value.sessId ?? null,
    connId: value.connId ?? null,
    isRestore: value.isRestore ?? 0,
  };
}

async function addManualAccount() {
  saving.value = true;
  try {
    const parsed = decodeTokenPayload(manualAccount.token);
    await request("/api/tokens", {
      method: "POST",
      body: {
        name: manualAccount.name || `角色-${parsed.roleId || Date.now()}`,
        token: JSON.stringify(parsed),
        roleId: parsed.roleId,
        sessId: parsed.sessId,
        connId: parsed.connId,
        isRestore: parsed.isRestore,
        enabled: true,
      },
    });
    manualAccount.name = "";
    manualAccount.token = "";
    manualAccountVisible.value = false;
    await loadAccounts();
    message.success("服务器账号已添加");
  } catch (error) {
    message.error(error.message);
  } finally {
    saving.value = false;
  }
}

async function importBackup(event) {
  const file = event.target.files?.[0];
  event.target.value = "";
  if (!file) return;
  try {
    const backup = JSON.parse(await file.text());
    let source = backup?.localStorage?.gameTokens;
    if (typeof source === "string") source = JSON.parse(source);
    if (!Array.isArray(source) || source.length === 0) {
      throw new Error("备份中没有 localStorage.gameTokens");
    }
    let imported = 0;
    for (const item of source) {
      const parsed = decodeTokenPayload(item.token);
      if (!parsed.roleToken) continue;
      await request("/api/tokens", {
        method: "POST",
        body: {
          name: item.name || `角色-${parsed.roleId || Date.now()}`,
          token: JSON.stringify(parsed),
          roleId: parsed.roleId ?? item.roleId ?? null,
          sessId: parsed.sessId,
          connId: parsed.connId,
          isRestore: parsed.isRestore,
          ws_url: item.wsUrl || null,
          server: item.server || null,
          enabled: true,
        },
      });
      imported += 1;
    }
    await loadAccounts();
    message.success(`已导入 ${imported} 个账号`);
  } catch (error) {
    message.error(`导入失败：${error.message}`);
  }
}

async function syncAccountsToLocal() {
  let created = 0;
  let updated = 0;
  for (const account of accounts.value) {
    const parsed = decodeTokenPayload(account.token);
    const fields = {
      token: createBrowserTokenValue(parsed),
      wsUrl: account.ws_url || null,
      server: account.server || "",
      roleId: parsed.roleId ?? account.roleId ?? null,
    };
    const existing = tokenStore.gameTokens.find(
      (token) => token.id === account.id,
    );
    if (existing) {
      tokenStore.updateToken(account.id, fields);
      updated += 1;
    } else {
      tokenStore.addToken({
        id: account.id,
        name: account.name,
        ...fields,
        importMethod: "manual",
      });
      created += 1;
    }
  }
  message.success(`已同步服务器账号：新增 ${created} 个，修复 ${updated} 个`);
}

async function syncLocalAccounts() {
  saving.value = true;
  try {
    const result = await syncLocalTokensToServer({
      tokens: tokenStore.gameTokens,
      request,
    });
    await loadAccounts();
    if (result.failed) {
      message.warning(
        `同步完成：新增 ${result.created} 个，更新 ${result.updated} 个，${result.failed} 个 Token 无法解析`,
      );
    } else {
      message.success(
        `已同步本机账号：新增 ${result.created} 个，更新 ${result.updated} 个`,
      );
    }
  } catch (error) {
    message.error(`同步本机账号失败：${error.message}`);
  } finally {
    saving.value = false;
  }
}

function openTaskDialog(task = null) {
  Object.assign(
    taskDraft,
    task
      ? {
          ...task,
          cron_expr: cronExpression(task),
          selected_tasks: normalizeSelectedTaskKeys(task),
          selected_tokens: selectedTokenIds(task),
          options: normalizeTaskOptions(task.options || task.task_options),
          enabled: Boolean(task.enabled),
        }
      : emptyTask(),
  );
  applyOptionDefaults();
  taskDialogVisible.value = true;
}

function toggleDraftValue(key, value) {
  const list = taskDraft[key];
  const index = list.indexOf(value);
  if (index >= 0) list.splice(index, 1);
  else {
    list.push(value);
    if (key === "selected_tasks") applyOptionDefaults();
  }
}

function applyOptionDefaults() {
  for (const definition of definitions.value) {
    if (!taskDraft.selected_tasks.includes(definition.key)) continue;
    for (const option of definition.options || []) {
      if (taskDraft.options[option.key] === undefined) {
        taskDraft.options[option.key] = Array.isArray(option.default)
          ? [...option.default]
          : option.default;
      }
    }
  }
}

function selectAllTasks() {
  taskDraft.selected_tasks = definitions.value.map(
    (definition) => definition.key,
  );
  applyOptionDefaults();
}

function selectedTaskOptions() {
  const result = {};
  for (const definition of selectedOptionDefinitions.value) {
    for (const option of definition.options || []) {
      const value = taskDraft.options[option.key];
      if (value !== undefined && value !== null && value !== "") {
        result[option.key] = value;
      }
    }
  }
  return result;
}

function openDreamConfig() {
  dreamConfigDraft.value = normalizeDreamSelection(
    taskDraft.options.dreamPurchaseList,
  );
  dreamConfigVisible.value = true;
}

function toggleDreamDraftItem(itemKey, checked) {
  const selected = new Set(dreamConfigDraft.value);
  if (checked) selected.add(itemKey);
  else selected.delete(itemKey);
  dreamConfigDraft.value = [...selected];
}

function selectGoldDreamItems() {
  const selected = new Set(dreamConfigDraft.value);
  for (const [merchantId, indexes] of Object.entries(goldItemsConfig)) {
    for (const itemIndex of indexes) {
      selected.add(`${merchantId}-${itemIndex}`);
    }
  }
  dreamConfigDraft.value = [...selected];
}

function selectAllDreamItems() {
  const selected = new Set(dreamConfigDraft.value);
  for (const [merchantId, merchant] of Object.entries(merchantConfig)) {
    merchant.items.forEach((_, itemIndex) => {
      selected.add(`${merchantId}-${itemIndex}`);
    });
  }
  dreamConfigDraft.value = [...selected];
}

function saveDreamConfig() {
  taskDraft.options.dreamPurchaseList = [...dreamConfigDraft.value];
  dreamConfigVisible.value = false;
  message.success("梦境商品购买配置已保存");
}

async function saveTask() {
  if (!taskDraft.name.trim()) return message.warning("请填写任务名称");
  if (!taskDraft.cron_expr.trim()) return message.warning("请填写 Cron");
  if (!taskDraft.selected_tasks.length)
    return message.warning("至少选择一个任务");
  if (!taskDraft.selected_tokens.length)
    return message.warning("至少选择一个账号");
  for (const definition of selectedOptionDefinitions.value) {
    for (const option of definition.options || []) {
      const value = taskDraft.options[option.key];
      if (
        option.required &&
        (value === undefined || value === null || value === "")
      ) {
        return message.warning(`请填写“${definition.name}”的${option.label}`);
      }
    }
  }

  saving.value = true;
  try {
    const body = {
      name: taskDraft.name.trim(),
      cron_expr: taskDraft.cron_expr.trim(),
      selected_tasks: [...taskDraft.selected_tasks],
      selected_tokens: [...taskDraft.selected_tokens],
      options: selectedTaskOptions(),
      enabled: Boolean(taskDraft.enabled),
    };
    await request(
      taskDraft.id
        ? `/api/tasks/${encodeURIComponent(taskDraft.id)}`
        : "/api/tasks",
      { method: taskDraft.id ? "PATCH" : "POST", body },
    );
    taskDialogVisible.value = false;
    await loadTasks();
    message.success("服务器任务已保存");
  } catch (error) {
    message.error(error.message);
  } finally {
    saving.value = false;
  }
}

async function runTask(task) {
  try {
    await request(`/api/tasks/${encodeURIComponent(task.id)}/run`, {
      method: "POST",
      body: {},
    });
    message.success(`已触发：${task.name}`);
    setTimeout(loadLogs, 1500);
    setTimeout(loadTasks, 5000);
    setTimeout(loadLogs, 5000);
  } catch (error) {
    message.error(error.message);
  }
}

function deleteTask(task) {
  dialog.warning({
    title: "删除服务器任务",
    content: `确定删除“${task.name}”吗？`,
    positiveText: "删除",
    negativeText: "取消",
    onPositiveClick: async () => {
      try {
        await request(`/api/tasks/${encodeURIComponent(task.id)}`, {
          method: "DELETE",
        });
        await loadTasks();
        message.success("任务已删除");
      } catch (error) {
        message.error(error.message);
      }
    },
  });
}

watch(autoRefresh, (enabled) => {
  if (autoRefreshTimer) clearInterval(autoRefreshTimer);
  autoRefreshTimer = enabled ? setInterval(loadLogs, 10_000) : null;
});

onMounted(() => {
  connect();
  nextRunTimer = setInterval(() => {
    clockTick.value = Date.now();
  }, 30_000);
});
onBeforeUnmount(() => {
  if (autoRefreshTimer) clearInterval(autoRefreshTimer);
  if (nextRunTimer) clearInterval(nextRunTimer);
});
</script>

<style scoped>
.server-page {
  display: flex;
  flex-direction: column;
  gap: 18px;
  max-width: 1280px;
  margin: 0 auto;
  padding: 24px;
}

.page-head,
.panel-title,
.switch-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 16px;
}

.page-head h1,
.panel-title h2 {
  margin: 0;
}

.page-head p,
.panel-title p {
  margin: 5px 0 0;
  color: var(--text-secondary);
}

.panel {
  padding: 18px;
  border: 1px solid var(--border-light);
  border-radius: 14px;
  background: var(--bg-primary);
}

.connection-grid {
  display: grid;
  grid-template-columns: 1.15fr 1fr;
  gap: 12px;
  margin-top: 16px;
}

.table-wrap {
  margin-top: 16px;
  overflow-x: auto;
}

table {
  width: 100%;
  border-collapse: collapse;
  font-size: 14px;
}

th,
td {
  padding: 11px 10px;
  border-bottom: 1px solid var(--border-light);
  text-align: left;
}

th {
  color: var(--text-secondary);
  font-weight: 600;
  white-space: nowrap;
}

.actions {
  text-align: right;
  white-space: nowrap;
}

.actions :deep(.n-button) {
  margin-left: 8px;
}

.actions :deep(.n-button:first-child) {
  margin-left: 0;
}

.empty-cell {
  padding: 28px;
  color: var(--text-secondary);
  text-align: center;
}

.logs td:last-child {
  min-width: 420px;
}

.log-category code {
  display: block;
  margin-top: 4px;
  color: var(--text-secondary);
  white-space: nowrap;
}

.log-account {
  margin-right: 8px;
  font-weight: 600;
}

code {
  padding: 2px 6px;
  border-radius: 5px;
  background: var(--bg-tertiary);
}

.hidden-input {
  display: none;
}

.dialog-card {
  width: min(760px, 92vw);
}

.task-dialog {
  max-height: 90vh;
  overflow-y: auto;
}

.dream-config-modal {
  width: min(900px, 92vw);
  max-height: 90vh;
  overflow-y: auto;
}

.account-settings-dialog {
  width: min(640px, 92vw);
}

.account-settings-grid {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 14px;
}

.settings-switches {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 10px;
}

.settings-switches label {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  padding: 10px 12px;
  border: 1px solid var(--border-light);
  border-radius: 8px;
}

.account-settings-button {
  margin-left: auto;
}

.merchant-group h3 {
  margin: 0 0 10px;
  font-size: 17px;
}

.field {
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.field-title-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
}

.presets {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
}

.check-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(150px, 1fr));
  gap: 8px;
  max-height: 220px;
  overflow-y: auto;
}

.check-item {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 8px;
  border: 1px solid var(--border-light);
  border-radius: 8px;
}

.task-types {
  max-height: 260px;
}

.task-option-card {
  border: 1px solid var(--border-light);
}

.option-grid {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(220px, 1fr));
  gap: 12px;
}

.option-field {
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.required {
  color: var(--error-color);
}

.switch-row {
  padding: 12px 0;
}

@media (max-width: 760px) {
  .server-page {
    padding: 14px;
  }

  .page-head,
  .panel-title {
    align-items: flex-start;
    flex-direction: column;
  }

  .connection-grid {
    grid-template-columns: 1fr;
  }

  .account-settings-grid,
  .settings-switches {
    grid-template-columns: 1fr;
  }
}
</style>
