import { migration as core } from "./0001-core.js";
import { migration as integrations } from "./0002-integrations.js";
import { migration as missions } from "./0003-missions.js";
import { migration as localData } from "./0004-local-data.js";
import { migration as chat } from "./0005-chat.js";
import { migration as agentTaskFiles } from "./0006-agent-task-files.js";
import { migration as taskContexts } from "./0007-task-contexts.js";
import { migration as agentTaskWorktree } from "./0008-agent-task-worktree.js";
import { migration as agentTaskResults } from "./0009-agent-task-results.js";
import { migration as agentTaskLeases } from "./0010-agent-task-leases.js";
import { migration as agentTaskExecutionContext } from "./0011-agent-task-execution-context.js";
import { migration as agentTaskEffects } from "./0012-agent-task-effects.js";

/** Ordered list of `{ version, name, sql }`. Versions are unique, ascending and gap-free. */
export const MIGRATIONS = Object.freeze([core, integrations, missions, localData, chat, agentTaskFiles, taskContexts, agentTaskWorktree, agentTaskResults, agentTaskLeases, agentTaskExecutionContext, agentTaskEffects]);

export const LATEST_VERSION = MIGRATIONS[MIGRATIONS.length - 1].version;
