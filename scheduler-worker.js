const RETRY_DELAYS_MS = [5000, 10000, 15000];
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function taskIdForCron(event, env) {
  const [, hourField] = event.cron.split(" ");
  if (hourField === "16") return env.DAILY_TASK_ID;
  if (hourField === "0") return env.ARENA_TASK_ID;
  return "";
}

async function runOnce(event, env) {
  const taskId = taskIdForCron(event, env);
  if (!taskId || !env.RENDER_BACKEND_URL || !env.RENDER_API_KEY) {
    throw new Error("Scheduler environment is incomplete");
  }

  const target = new URL(
    `/api/tasks/${encodeURIComponent(taskId)}/run-once`,
    env.RENDER_BACKEND_URL,
  );
  let response;
  for (let attempt = 0; attempt <= RETRY_DELAYS_MS.length; attempt += 1) {
    response = await fetch(target, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-API-Key": env.RENDER_API_KEY,
      },
      body: "{}",
    });
    if (
      ![502, 503, 504].includes(response.status) ||
      attempt === RETRY_DELAYS_MS.length
    ) {
      break;
    }
    await response.body?.cancel();
    await sleep(RETRY_DELAYS_MS[attempt]);
  }

  if (!response.ok && response.status !== 409) {
    throw new Error(`Render scheduler request failed: HTTP ${response.status}`);
  }
  return response;
}

export default {
  async scheduled(event, env) {
    await runOnce(event, env);
  },
};

export const __test = { runOnce, taskIdForCron };
