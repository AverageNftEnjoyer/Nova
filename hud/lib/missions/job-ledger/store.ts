import "server-only"

import { jobLedger as sqliteJobLedger } from "../../../../src/runtime/modules/services/missions/job-ledger/index.js"
import type { JobLedgerStore } from "./types"

export const jobLedger = sqliteJobLedger as unknown as JobLedgerStore
