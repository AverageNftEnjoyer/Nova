function requireFunction(dependencies, key) {
  const candidate = dependencies?.[key];
  if (typeof candidate !== "function") {
    throw new Error(`Mission scheduler dependency "${key}" is required.`);
  }
  return candidate;
}

export function ensureMissionSchedulerStarted(dependencies = {}) {
  const startScheduler = requireFunction(dependencies, "startScheduler");
  return startScheduler();
}
