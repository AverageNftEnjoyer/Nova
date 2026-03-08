export function planExecutionTickCandidates(
  pendingRuns,
  {
    batchSize = 10,
    perUserLimit = 3,
  } = {},
) {
  const normalizedBatchSize = Math.max(1, Number(batchSize || 1));
  const normalizedPerUserLimit = Math.max(1, Number(perUserLimit || 1));
  const queuesByUser = new Map();
  const roundRobinUsers = [];
  const selectedRuns = [];
  const selectedByUser = new Map();

  for (const run of Array.isArray(pendingRuns) ? pendingRuns : []) {
    const userId = String(run?.user_id || "").trim();
    if (!userId) continue;
    let queue = queuesByUser.get(userId);
    if (!queue) {
      queue = [];
      queuesByUser.set(userId, queue);
      roundRobinUsers.push(userId);
    }
    queue.push(run);
  }

  let userCursor = 0;
  while (selectedRuns.length < normalizedBatchSize && roundRobinUsers.length > 0) {
    const index = userCursor % roundRobinUsers.length;
    const userId = roundRobinUsers[index];
    const queue = queuesByUser.get(userId) || [];
    const taken = Number(selectedByUser.get(userId) || 0);

    if (queue.length === 0 || taken >= normalizedPerUserLimit) {
      queuesByUser.delete(userId);
      roundRobinUsers.splice(index, 1);
      if (roundRobinUsers.length === 0) break;
      continue;
    }

    const run = queue.shift();
    if (run) {
      selectedRuns.push(run);
      selectedByUser.set(userId, taken + 1);
    }

    if (queue.length === 0 || taken + 1 >= normalizedPerUserLimit) {
      queuesByUser.delete(userId);
      roundRobinUsers.splice(index, 1);
      if (roundRobinUsers.length === 0) break;
    } else {
      userCursor = (userCursor + 1) % roundRobinUsers.length;
    }
  }

  return selectedRuns;
}

export function createTickMissionSnapshotCache(loadUserMissions) {
  const missionsByUser = new Map();

  async function loadMissionMap(userId) {
    const normalizedUserId = String(userId || "").trim();
    if (!normalizedUserId) return new Map();
    let existing = missionsByUser.get(normalizedUserId);
    if (!existing) {
      existing = Promise.resolve(loadUserMissions({ userId: normalizedUserId })).then((missions) => new Map(
        (Array.isArray(missions) ? missions : [])
          .filter((mission) => mission && typeof mission === "object" && String(mission.id || "").trim())
          .map((mission) => [String(mission.id || "").trim(), mission]),
      ));
      missionsByUser.set(normalizedUserId, existing);
    }
    return existing;
  }

  return {
    async getMission(userId, missionId) {
      const missionMap = await loadMissionMap(userId);
      return missionMap.get(String(missionId || "").trim()) ?? null;
    },
  };
}
