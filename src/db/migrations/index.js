import { migration as core } from "./0001-core.js";
import { migration as integrations } from "./0002-integrations.js";
import { migration as missions } from "./0003-missions.js";
import { migration as localData } from "./0004-local-data.js";
import { migration as chat } from "./0005-chat.js";

/** Ordered list of `{ version, name, sql }`. Versions are unique, ascending and gap-free. */
export const MIGRATIONS = Object.freeze([core, integrations, missions, localData, chat]);

export const LATEST_VERSION = MIGRATIONS[MIGRATIONS.length - 1].version;
