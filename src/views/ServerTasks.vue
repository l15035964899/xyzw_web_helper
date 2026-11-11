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
                <n-button text type="primary" @click="toggleAccount(account)">
                  {{ account.enabled ? "停用" : "启用" }}
                </n-button>
                <n-button text type="error" @click="deleteAccount(account)">
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
        <n-button type="primary" @click="openTaskDialog()">新增任务</n-button>
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
              <th class="actions">操作</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="task in tasks" :key="task.id">
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
              <td class="actions">
                <n-button text type="primary" @click="runTask(task)">
                  立刻执行
                </n-button>
                <n-button text @click="openTaskDialog(task)">编辑</n-button>
                <n-button text type="error" @click="deleteTask(task)">
                  删除
                </n-button>
              </td>
            </tr>
            <tr v-if="!tasks.length">
              <td colspan="6" class="empty-cell">还没有服务器定时任务</td>
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
              <td>{{ entry.task_type || "-" }}</td>
              <td>
                <span v-if="entry.token_name">{{ entry.token_name }}：</span>
                {{ entry.message || "-" }}
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
            <label>包含任务</label>
            <div class="check-grid task-types">
              <label
                v-for="definition in definitions"
                :key="definition.key"
                class="check-item"
              >
                <input
                  type="checkbox"
                  :checked="taskDraft.selected_tasks.includes(definition.key)"
                  @change="toggleDraftValue('selected_tasks', definition.key)"
                />
                <span>{{ definition.name }}</span>
              </label>
            </div>
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
const saving = ref(false);
const connectionState = ref("idle");
const errorMessage = ref("");
const autoRefresh = ref(false);
const backupInput = ref(null);
const manualAccountVisible = ref(false);
const taskDialogVisible = ref(false);
const manualAccount = reactive({ name: "", token: "" });
let autoRefreshTimer = null;

const cronPresets = [
  { label: "每天 08:00", expr: "0 8 * * *" },
  { label: "每天 08:00 + 20:00", expr: "0 8,20 * * *" },
  { label: "每 5 小时", expr: "0 */5 * * *" },
  { label: "每 6 小时", expr: "0 */6 * * *" },
  { label: "每小时", expr: "0 * * * *" },
];

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
    enabled: true,
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

function selectedTokenIds(task) {
  return normalizeArray(task.selected_tokens || task.token_ids);
}

function cronExpression(task) {
  return task.cron_expr || task.cron_expression || "-";
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
  let imported = 0;
  for (const account of accounts.value) {
    const existing = tokenStore.gameTokens.some(
      (token) => token.id === account.id,
    );
    if (existing) continue;
    const parsed = decodeTokenPayload(account.token);
    tokenStore.addToken({
      id: account.id,
      name: account.name,
      token: parsed.roleToken,
      wsUrl: account.ws_url || null,
      server: account.server || "",
      roleId: parsed.roleId ?? account.roleId ?? null,
      importMethod: "manual",
    });
    imported += 1;
  }
  message.success(
    imported ? `已同步 ${imported} 个账号到本机` : "本机已包含全部服务器账号",
  );
}

function openTaskDialog(task = null) {
  Object.assign(
    taskDraft,
    task
      ? {
          ...task,
          cron_expr: cronExpression(task),
          selected_tasks: normalizeArray(task.selected_tasks || task.task_type),
          selected_tokens: selectedTokenIds(task),
          enabled: Boolean(task.enabled),
        }
      : emptyTask(),
  );
  taskDialogVisible.value = true;
}

function toggleDraftValue(key, value) {
  const list = taskDraft[key];
  const index = list.indexOf(value);
  if (index >= 0) list.splice(index, 1);
  else list.push(value);
}

async function saveTask() {
  if (!taskDraft.name.trim()) return message.warning("请填写任务名称");
  if (!taskDraft.cron_expr.trim()) return message.warning("请填写 Cron");
  if (!taskDraft.selected_tasks.length)
    return message.warning("至少选择一个任务");
  if (!taskDraft.selected_tokens.length)
    return message.warning("至少选择一个账号");

  saving.value = true;
  try {
    const body = {
      name: taskDraft.name.trim(),
      cron_expr: taskDraft.cron_expr.trim(),
      selected_tasks: [...taskDraft.selected_tasks],
      selected_tokens: [...taskDraft.selected_tokens],
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

onMounted(connect);
onBeforeUnmount(() => {
  if (autoRefreshTimer) clearInterval(autoRefreshTimer);
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

.empty-cell {
  padding: 28px;
  color: var(--text-secondary);
  text-align: center;
}

.logs td:last-child {
  min-width: 420px;
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

.field {
  display: flex;
  flex-direction: column;
  gap: 8px;
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
}
</style>
