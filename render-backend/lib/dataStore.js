import process from "node:process";
import { createClient } from "@supabase/supabase-js";
import { createLocalStore } from "./localStore.js";

function throwIfError(error) {
  if (error) throw new Error(error.message);
}

function createSupabaseStore(url, key) {
  if (!url || !key) {
    throw new Error("SUPABASE_URL and SUPABASE_KEY are required");
  }
  const supabase = createClient(url, key);

  async function listTokens({ enabledOnly = false } = {}) {
    let query = supabase.from("tokens").select("*").order("created_at");
    if (enabledOnly) query = query.eq("enabled", true);
    const { data, error } = await query;
    throwIfError(error);
    return data || [];
  }

  async function createToken(input) {
    const { data, error } = await supabase
      .from("tokens")
      .insert(input)
      .select()
      .single();
    throwIfError(error);
    return data;
  }

  async function updateToken(id, patch) {
    const { data, error } = await supabase
      .from("tokens")
      .update(patch)
      .eq("id", id)
      .select()
      .maybeSingle();
    throwIfError(error);
    return data;
  }

  async function deleteToken(id) {
    const { error } = await supabase.from("tokens").delete().eq("id", id);
    throwIfError(error);
    return true;
  }

  async function listTasks({ enabledOnly = false } = {}) {
    let query = supabase.from("cron_tasks").select("*").order("created_at");
    if (enabledOnly) query = query.eq("enabled", true);
    const { data, error } = await query;
    throwIfError(error);
    return data || [];
  }

  async function getTask(id) {
    const { data, error } = await supabase
      .from("cron_tasks")
      .select("*")
      .eq("id", id)
      .maybeSingle();
    throwIfError(error);
    return data;
  }

  async function createTask(input) {
    const { data, error } = await supabase
      .from("cron_tasks")
      .insert(input)
      .select()
      .single();
    throwIfError(error);
    return data;
  }

  async function updateTask(id, patch) {
    const { data, error } = await supabase
      .from("cron_tasks")
      .update(patch)
      .eq("id", id)
      .select()
      .maybeSingle();
    throwIfError(error);
    return data;
  }

  async function markTaskRun(id, at = new Date().toISOString()) {
    return updateTask(id, { last_run_at: at });
  }

  async function deleteTask(id) {
    const { error } = await supabase.from("cron_tasks").delete().eq("id", id);
    throwIfError(error);
    return true;
  }

  async function appendTaskLog(input) {
    const { data, error } = await supabase
      .from("task_logs")
      .insert(input)
      .select()
      .single();
    throwIfError(error);
    return data;
  }

  async function listTaskLogs(limit = 100) {
    const { data, error } = await supabase
      .from("task_logs")
      .select("*")
      .order("created_at", { ascending: false })
      .limit(limit);
    throwIfError(error);
    return data || [];
  }

  async function deleteTaskLogsBefore(cutoff) {
    const { error } = await supabase
      .from("task_logs")
      .delete()
      .lt("created_at", new Date(cutoff).toISOString());
    throwIfError(error);
    return 0;
  }

  return {
    kind: "supabase",
    init: async () => {},
    listTokens,
    createToken,
    updateToken,
    deleteToken,
    listTasks,
    getTask,
    createTask,
    updateTask,
    markTaskRun,
    deleteTask,
    appendTaskLog,
    listTaskLogs,
    deleteTaskLogsBefore,
  };
}

export function createDataStore(env = process.env) {
  const localDataDir = env.DATA_DIR || env.LOCAL_DATA_DIR;
  if (env.STORE_MODE === "local" || localDataDir) {
    return createLocalStore({ dataDir: localDataDir || "/data" });
  }
  return createSupabaseStore(env.SUPABASE_URL, env.SUPABASE_KEY);
}
