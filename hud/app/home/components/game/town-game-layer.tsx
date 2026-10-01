"use client"

import { useCallback, useState } from "react"
import type { CityHotspot } from "@/components/pixel-city"
import type { TownQuest } from "@/lib/town/types"
import type { TownProgressState } from "../../hooks/use-town-progress"
import { QuestLogWindow } from "./quest-log-window"
import { TownCelebrations } from "./town-celebrations"
import { TutorialGuide } from "./tutorial-guide"

interface TownGameLayerProps {
  town: TownProgressState
  assistantName: string
  hotspots: readonly CityHotspot[]
  questLogOpen: boolean
  onCloseQuestLog: () => void
  /** Takes the user to a quest's target (useQuestNavigator). */
  onGo: (quest: TownQuest) => void
}

/** Everything game-like that floats over the city: the quest log, the tutorial guide and celebrations. */
export function TownGameLayer({ town, assistantName, hotspots, questLogOpen, onCloseQuestLog, onGo }: TownGameLayerProps) {
  const [tutorialMinimized, setTutorialMinimized] = useState(false)
  const { progress, ack } = town

  const goFromLog = useCallback(
    (quest: TownQuest) => {
      onCloseQuestLog()
      onGo(quest)
    },
    [onCloseQuestLog, onGo],
  )

  return (
    <>
      {progress ? (
        <TutorialGuide
          progress={progress}
          assistantName={assistantName}
          hotspots={hotspots}
          minimized={tutorialMinimized}
          onMinimize={setTutorialMinimized}
          onGo={onGo}
          onSkip={() => void ack({ tutorial: "skip" })}
          onFinish={() => void ack({ tutorial: "finish" })}
        />
      ) : null}

      {questLogOpen ? (
        <QuestLogWindow
          town={town}
          onClose={onCloseQuestLog}
          onGo={goFromLog}
          onShowTutorial={() => {
            setTutorialMinimized(false)
            onCloseQuestLog()
          }}
          onRestartTutorial={() => {
            setTutorialMinimized(false)
            onCloseQuestLog()
            void ack({ tutorial: "restart" })
          }}
        />
      ) : null}

      {progress ? <TownCelebrations events={progress.pendingEvents} ack={ack} /> : null}
    </>
  )
}
