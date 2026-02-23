import type { Mission, MissionConnection, MissionNode } from "../../types"

export type MissionDiffOperation =
  | {
      type: "addNode"
      node: MissionNode
    }
  | {
      type: "removeNode"
      nodeId: string
    }
  | {
      type: "updateNode"
      nodeId: string
      patch: Partial<MissionNode>
    }
  | {
      type: "moveNode"
      nodeId: string
      position: MissionNode["position"]
    }
  | {
      type: "addConnection"
      connection: MissionConnection
    }
  | {
      type: "removeConnection"
      connectionId: string
    }
  | {
      type: "updateMissionMetadata"
      patch: Partial<Pick<Mission, "label" | "description" | "status" | "tags" | "settings" | "integration" | "chatIds">>
    }

export interface MissionDiffApplyInput {
  mission: Mission
  operations: MissionDiffOperation[]
  expectedVersion?: number
  nowIso?: string
}

export interface MissionDiffIssue {
  code: string
  operationIndex: number
  path: string
  message: string
}

export interface MissionDiffApplyResult {
  ok: boolean
  mission?: Mission
  appliedCount: number
  issues: MissionDiffIssue[]
}

export interface MissionDiffJournalEntry {
  userContextId: string
  missionId: string
  actorId: string
  ts: string
  expectedVersion?: number
  previousVersion: number
  nextVersion?: number
  ok: boolean
  operationCount: number
  appliedCount: number
  issueCount: number
  operations: MissionDiffOperation[]
  issues: MissionDiffIssue[]
}
