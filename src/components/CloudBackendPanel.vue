<template>
  <n-button size="small" type="info" @click="openPanel">云端任务</n-button>

  <n-drawer v-model:show="showPanel" :width="720" placement="right">
    <n-drawer-content title="Render + Supabase 云端任务" closable>
      <n-space vertical :size="16">
        <n-alert type="warning" :bordered="false">
          云端任务启用后会由 Render 按 Cron 自动执行。切换前请先停用 NAS
          上相同的任务，避免重复操作游戏账号。
        </n-alert>

        <n-space align="center" justify="space-between">
          <n-space align="center">
            <n-tag :type="healthTagType" size="small">{{ healthText }}</n-tag>
            <span v-if="health?.activeCrons !== undefined" class="meta-text">
              已注册 {{ health.activeCrons }} 个任务
            </span>
          </n-space>
          <n-space>
            <n-button size="small" :loading="loading" @click="refresh">
              刷新
            </n-button>
            <n-button size="small" @click="showKeyModal = true">
              {{ hasAccessKey ? "更换访问密钥" : "配置访问密钥" }}
            </n-button>
          </n-space>
        </n-space>

        <n-alert v-if="errorMessage" type="error" :bordered="false">
          {{ errorMessage }}
        </n-alert>

        <n-empty
          v-if="!hasAccessKey"
          description="配置访问密钥后才能查看和管理云端任务"
        />

        <template v-else>
          <n-card
            v-for="task in tasks"
            :key="task.id"
            size="small"
            :title="task.name"
          >
            <template #header-extra>
              <n-switch
                :value="task.enabled"
                :loading="updatingTaskId === task.id"
                @update:value="(enabled) => toggleTask(task, enabled)"
              />
            </template>
            <n-descriptions :column="1" label-placement="left" size="small">
              <n-descriptions-item label="Cron">
                {{ task.cron_expr || task.cron_expression || "-" }}
              </n-descriptions-item>
              <n-descriptions-item label="云端任务">
                <n-space :size="4">
                  <n-tag
                    v-for="name in normalizeArray(task.selected_tasks)"
                    :key="name"
                    size="tiny"
                    :type="supportedTaskKeys.has(name) ? 'success' : 'warning'"
                  >
                    {{ name }}
                  </n-tag>
                </n-space>
              </n-descriptions-item>
              <n-descriptions-item label="上次运行">
                {{ formatDate(task.last_run_at) }}
              </n-descriptions-item>
            </n-descriptions>
            <template #action>
              <n-button
                size="small"
                type="primary"
                :loading="runningTaskId === task.id"
                @click="confirmRunTask(task)"
              >
                立即执行
              </n-button>
            </template>
          </n-card>

          <n-empty
            v-if="!loading && tasks.length === 0"
            description="暂无云端任务"
          />

          <n-collapse>
            <n-collapse-item title="最近云端日志" name="logs">
              <n-list v-if="logs.length > 0" hoverable>
                <n-list-item v-for="entry in logs" :key="entry.id">
                  <n-space vertical :size="2">
                    <n-space align="center" :size="6">
                      <n-tag
                        size="tiny"
                        :type="entry.status === 'success' ? 'success' : 'error'"
                      >
                        {{ entry.status }}
                      </n-tag>
                      <span>{{ entry.token_name || "未知账号" }}</span>
                      <span class="meta-text">{{ entry.task_type }}</span>
                    </n-space>
                    <span v-if="entry.message" class="log-message">
                      {{ entry.message }}
                    </span>
                    <span class="meta-text">{{
                      formatDate(entry.created_at)
                    }}</span>
                  </n-space>
                </n-list-item>
              </n-list>
              <n-empty v-else size="small" description="暂无数据库日志" />
            </n-collapse-item>
          </n-collapse>
        </template>
      </n-space>
    </n-drawer-content>
  </n-drawer>

  <n-modal v-model:show="showKeyModal">
    <n-card
      style="width: min(520px, 92vw)"
      title="云端访问密钥"
      :bordered="false"
      size="small"
    >
      <n-space vertical>
        <n-alert type="info" :bordered="false">
          该密钥只用于向 Cloudflare Worker 验证此浏览器的管理权限，不是游戏
          Token 或 Supabase 密钥。
        </n-alert>
        <n-input
          v-model:value="accessKeyDraft"
          type="password"
          show-password-on="click"
          placeholder="输入 Cloudflare 中配置的 REMOTE_ACCESS_KEY"
          @keyup.enter="saveAccessKey"
        />
        <n-space justify="end">
          <n-button @click="showKeyModal = false">取消</n-button>
          <n-button type="primary" @click="saveAccessKey">保存并验证</n-button>
        </n-space>
      </n-space>
    </n-card>
  </n-modal>
</template>

<script setup>
import { useDialog, useMessage } from "naive-ui";
import { computed, ref } from "vue";
import {
  getRemoteAccessKey,
  renderBackendApi,
  setRemoteAccessKey,
} from "@/api/renderBackend";

const message = useMessage();
const dialog = useDialog();
const showPanel = ref(false);
const showKeyModal = ref(false);
const loading = ref(false);
const errorMessage = ref("");
const health = ref(null);
const tasks = ref([]);
const definitions = ref([]);
const logs = ref([]);
const accessKey = ref(getRemoteAccessKey());
const accessKeyDraft = ref(accessKey.value);
const updatingTaskId = ref("");
const runningTaskId = ref("");

const hasAccessKey = computed(() => Boolean(accessKey.value));
const supportedTaskKeys = computed(
  () => new Set(definitions.value.map(({ key }) => key)),
);
const healthText = computed(() => {
  if (loading.value) return "正在连接";
  if (!health.value) return "未连接";
  return health.value.status === "ok" ? "Render 正常" : "状态异常";
});
const healthTagType = computed(() => {
  if (loading.value) return "info";
  if (!health.value) return "default";
  return health.value.status === "ok" ? "success" : "error";
});

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

function formatDate(value) {
  if (!value) return "从未";
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? String(value) : date.toLocaleString();
}

async function refresh() {
  loading.value = true;
  errorMessage.value = "";
  try {
    health.value = await renderBackendApi.health();
    if (!hasAccessKey.value) return;
    const [taskList, definitionList, logList] = await Promise.all([
      renderBackendApi.tasks(),
      renderBackendApi.definitions(),
      renderBackendApi.logs(30),
    ]);
    tasks.value = Array.isArray(taskList) ? taskList : [];
    definitions.value = Array.isArray(definitionList) ? definitionList : [];
    logs.value = Array.isArray(logList) ? logList : [];
  } catch (error) {
    errorMessage.value = error.message;
  } finally {
    loading.value = false;
  }
}

function openPanel() {
  showPanel.value = true;
  accessKeyDraft.value = accessKey.value;
  refresh();
}

async function saveAccessKey() {
  const key = setRemoteAccessKey(accessKeyDraft.value);
  if (!key) {
    message.warning("访问密钥不能为空");
    return;
  }
  accessKey.value = key;
  showKeyModal.value = false;
  await refresh();
  if (!errorMessage.value) message.success("云端访问密钥已验证");
}

function toggleTask(task, enabled) {
  const apply = async () => {
    updatingTaskId.value = task.id;
    try {
      const [updated] = await renderBackendApi.setTaskEnabled(task.id, enabled);
      if (updated) Object.assign(task, updated);
      await refresh();
      message.success(`云端任务已${enabled ? "启用" : "暂停"}`);
    } catch (error) {
      message.error(error.message);
    } finally {
      updatingTaskId.value = "";
    }
  };

  if (enabled) {
    dialog.warning({
      title: "启用云端定时任务",
      content:
        "Render 将按 Cron 自动执行此任务。请确认 NAS 上相同任务已停用，否则可能重复领取、购买或战斗。",
      positiveText: "确认启用",
      negativeText: "取消",
      onPositiveClick: apply,
    });
  } else {
    apply();
  }
}

function confirmRunTask(task) {
  dialog.warning({
    title: "立即执行云端任务",
    content: `将立即对 ${normalizeArray(task.selected_tokens).length} 个游戏账号执行“${task.name}”。这会真实操作游戏账号。`,
    positiveText: "立即执行",
    negativeText: "取消",
    onPositiveClick: async () => {
      runningTaskId.value = task.id;
      try {
        await renderBackendApi.runTask(task.id);
        message.success(`任务“${task.name}”已提交到 Render`);
      } catch (error) {
        message.error(error.message);
      } finally {
        runningTaskId.value = "";
      }
    },
  });
}
</script>

<style scoped>
.meta-text {
  color: var(--text-tertiary);
  font-size: 12px;
}

.log-message {
  word-break: break-word;
}
</style>
