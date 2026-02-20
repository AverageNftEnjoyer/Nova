export interface Message {
  id: string
  role: "user" | "assistant"
  content: string
  createdAt: Date
  imageData?: string
  source?: "hud" | "agent" | "voice"
  sender?: string
  nlpCleanText?: string
  nlpConfidence?: number
  nlpCorrectionCount?: number
  nlpBypass?: boolean
}
