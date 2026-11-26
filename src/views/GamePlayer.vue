<template>
  <div class="game-player">
    <button class="back-btn" @click="goBack">← 返回</button>

    <div class="iframe-wrapper">
      <iframe
        ref="gameFrame"
        :src="gameSrc"
        class="game-iframe"
        allow="fullscreen; autoplay"
      />
      <div v-if="fatal" class="game-error">
        <strong>游戏启动失败</strong>
        <span>请返回后重新打开，系统会再次从 NAS 获取 BIN。</span>
      </div>
    </div>
  </div>
</template>

<script setup>
import { onMounted, onUnmounted, ref } from "vue";
import { useRouter } from "vue-router";
import {
  buildSingleGameFrameSrc,
  clearGameSessionBinData,
  closeSingleGameSession,
  readActiveSingleGameLaunch,
} from "@/utils/gameLauncher";

const router = useRouter();
const session = readActiveSingleGameLaunch(window.sessionStorage)
  ?.sessions?.[0];
const gameSrc = session
  ? buildSingleGameFrameSrc(import.meta.env.BASE_URL, session)
  : `${import.meta.env.BASE_URL}game/index.html`;
const gameFrame = ref(null);
const fatal = ref(false);

function clearBinData() {
  if (!session) return;
  try {
    clearGameSessionBinData({
      scopeId: session.scopeId,
      localStorage: window.localStorage,
    });
  } catch {
    // Navigation cleanup remains best effort.
  }
}

function closeSession() {
  if (!session) return;
  try {
    closeSingleGameSession({
      scopeId: session.scopeId,
      localStorage: window.localStorage,
      sessionStorage: window.sessionStorage,
    });
  } catch {
    // Navigation cleanup remains best effort.
  }
}

function handleMessage(event) {
  if (
    !session ||
    event.origin !== window.location.origin ||
    event.source !== gameFrame.value?.contentWindow ||
    event.data?.channel !== "multi-game" ||
    event.data?.version !== 1 ||
    event.data?.scope !== session.scopeId
  ) {
    return;
  }
  if (["ready", "fatal"].includes(event.data.type)) clearBinData();
  if (event.data.type === "fatal") fatal.value = true;
}

function goBack() {
  clearBinData();
  closeSession();
  router.push("/admin/dashboard");
}

onMounted(() => window.addEventListener("message", handleMessage));
onUnmounted(() => {
  window.removeEventListener("message", handleMessage);
  clearBinData();
  closeSession();
});
</script>

<style scoped>
.game-player {
  position: fixed;
  inset: 0;
  z-index: 1;
  background: #000;
}

.iframe-wrapper {
  position: absolute;
  top: 0;
  left: 0;
  right: 0;
  bottom: 0;
}

.game-iframe {
  width: 100%;
  height: 100%;
  border: none;
  display: block;
}

.back-btn {
  position: absolute;
  top: 8px;
  left: 8px;
  z-index: 200;
  background: rgba(0, 0, 0, 0.5);
  color: #fff;
  border: none;
  padding: 6px 12px;
  border-radius: 6px;
  font-size: 14px;
  cursor: pointer;
  transition: background 0.2s;
}

.back-btn:hover {
  background: rgba(0, 0, 0, 0.7);
}

.back-btn:active {
  background: rgba(0, 0, 0, 0.8);
}

.game-error {
  position: absolute;
  inset: 0;
  display: grid;
  place-content: center;
  gap: 8px;
  padding: 24px;
  text-align: center;
  color: #fff;
  background: rgba(12, 16, 24, 0.92);
}

.game-error span {
  color: #b8c2d1;
}
</style>
