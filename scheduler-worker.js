const RETRY_DELAYS_MS = [5000, 10000, 15000];
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function taskForCron(event, env) {
  const [, hourField] = event.cron.split(" ");
  const hours = hourField.split(",").map(Number);
  if (hours.some((hour) => [17, 22, 3, 8, 13].includes(hour))) {
    return {
      taskId: env.RECURRING_TASK_ID,
      path: `/api/tasks/${encodeURIComponent(env.RECURRING_TASK_ID)}/run-if-due?minIntervalMinutes=285`,
    };
  }
  if (hourField === "16") {
    return {
      taskId: env.DAILY_TASK_ID,
      path: `/api/tasks/${encodeURIComponent(env.DAILY_TASK_ID)}/run-once`,
    };
  }
  if (hourField === "0") {
    return {
      taskId: env.ARENA_TASK_ID,
      path: `/api/tasks/${encodeURIComponent(env.ARENA_TASK_ID)}/run-once`,
    };
  }
  return null;
}

async function runOnce(event, env) {
  const targetTask = taskForCron(event, env);
  if (!targetTask?.taskId || !env.RENDER_BACKEND_URL || !env.RENDER_API_KEY) {
    throw new Error("Scheduler environment is incomplete");
  }

  const target = new URL(targetTask.path, env.RENDER_BACKEND_URL);
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

export const __test = { runOnce, taskForCron };
