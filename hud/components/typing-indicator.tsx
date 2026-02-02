"use client"

export function TypingIndicator() {
  return (
    <div className="flex gap-1.5 max-w-[90%] md:max-w-[80%] mr-auto animate-in fade-in slide-in-from-bottom-2 duration-300">
      {/* Spacer matching the avatar width in message-bubble so dots align with message text */}
      <div className="w-8 shrink-0" />

      {/* Typing dots */}
      <div
        className="px-4 py-3 rounded-2xl rounded-bl-md bg-s-5 border border-s-5"
        style={{
          boxShadow: "rgba(0, 0, 0, 0.2) 0px 2px 8px",
        }}
        role="status"
        aria-label="Assistant is typing"
      >
        <div className="flex items-center gap-1.5">
          <span className="w-2 h-2 rounded-full bg-gradient-to-r from-violet-400 to-purple-500 animate-bounce" style={{ animationDelay: "0ms", animationDuration: "0.6s" }} />
          <span className="w-2 h-2 rounded-full bg-gradient-to-r from-purple-400 to-pink-500 animate-bounce" style={{ animationDelay: "150ms", animationDuration: "0.6s" }} />
          <span className="w-2 h-2 rounded-full bg-gradient-to-r from-pink-400 to-rose-500 animate-bounce" style={{ animationDelay: "300ms", animationDuration: "0.6s" }} />
        </div>
      </div>
    </div>
  )
}
