"use client"

import type React from "react"
import { useNovaState } from "@/lib/chat/hooks/useNovaState"

type OrbPalette = {
  bg: string
  circle1: string
  circle2: string
  circle3: string
  circle4: string
  circle5: string
}

function hexToRgba(hex: string, alpha: number): string {
  const clean = hex.replace("#", "")
  const full = clean.length === 3 ? clean.split("").map((c) => c + c).join("") : clean
  const num = Number.parseInt(full, 16)
  const r = (num >> 16) & 255
  const g = (num >> 8) & 255
  const b = num & 255
  return `rgba(${r}, ${g}, ${b}, ${alpha})`
}

export function AnimatedOrb({
  className,
  variant = "default",
  size = 32,
  palette,
  showStateLabel = true,
}: {
  className?: string
  variant?: "default" | "red"
  size?: number
  palette?: OrbPalette
  showStateLabel?: boolean
}) {
  const { state, connected } = useNovaState()
  const useCustomPalette = variant !== "red" && !!palette

  const isSpeaking = state === "speaking"
  const isListening = state === "listening"
  const isThinking = state === "thinking"

  const colors =
    variant === "red"
      ? {
          bg: "#1a0a0a",
          circle1: "#ef4444",
          circle2: "#f87171",
          circle3: "#dc2626",
          circle4: "#fca5a5",
          circle5: "#fb7185",
        }
      : palette
      ? palette
      : {
          bg: "#1a1a2e",
          circle1: "#9e9fef",
          circle2: "#c471ec",
          circle3: "#818cf8",
          circle4: "#a78bfa",
          circle5: "#f472b6",
        }

  const blurAmount = Math.max(6, size * 0.15)
  const circle1Size = size * 0.45
  const circle2Size = size * 0.35
  const circle3Size = size * 0.5
  const circle4Size = size * 0.25
  const circle5Size = size * 0.3

  const speakingClass = isSpeaking ? "orb-speaking" : ""
  const circleClass = (num: number) =>
    isSpeaking || isListening
      ? `orb-circle-${num}-speaking`
      : `orb-circle-${num}`

  // State-dependent glow colors
  const stateGlow = isSpeaking
    ? `${hexToRgba(colors.circle1, 0.5)} 0px 0px 80px 20px, ${hexToRgba(colors.circle2, 0.4)} 0px 0px 160px 40px, ${hexToRgba(colors.circle4, 0.2)} 0px 0px 240px 60px`
    : isListening
    ? `${hexToRgba(colors.circle3, 0.35)} 0px 0px 60px 15px, ${hexToRgba(colors.circle1, 0.2)} 0px 0px 120px 30px`
    : isThinking
    ? `${hexToRgba(colors.circle4, 0.3)} 0px 0px 60px 15px, ${hexToRgba(colors.circle2, 0.15)} 0px 0px 120px 30px`
    : `${hexToRgba(colors.circle4, 0.15)} 0px 0px 40px 8px, ${hexToRgba(colors.circle3, 0.08)} 0px 0px 80px 20px`

  const motionAnimation = isSpeaking
    ? "orb-pulse 1.5s ease-in-out infinite"
    : isListening
    ? "orb-pulse 2s ease-in-out infinite, orb-listening-breathe 1.5s ease-in-out infinite"
    : isThinking
    ? "orb-thinking-spin 3s linear infinite"
    : "orb-idle-float 4s ease-in-out infinite"

  const colorAnimation = isSpeaking
    ? useCustomPalette
      ? "orb-custom-color-surge 1.25s ease-in-out infinite"
      : "orb-hue-rotate 3s linear infinite"
    : isListening
    ? useCustomPalette
      ? "orb-custom-color-breathe 2.2s ease-in-out infinite"
      : "orb-hue-rotate 4s linear infinite"
    : isThinking
    ? useCustomPalette
      ? "orb-custom-color-breathe 1.8s ease-in-out infinite"
      : "orb-hue-rotate 2s linear infinite"
    : useCustomPalette
    ? "orb-custom-color-breathe 3.2s ease-in-out infinite"
    : "orb-hue-rotate 10s linear infinite"

  return (
    <div
      className="relative"
      style={{
        width: size,
        height: size,
        animation: motionAnimation,
      }}
    >
      {/* State indicator ring */}
      {size >= 64 && (
        <div
          className="absolute rounded-full pointer-events-none"
          style={{
            inset: -4,
            border: `1px solid ${
              isSpeaking ? hexToRgba(colors.circle4, 0.45)
              : isListening ? hexToRgba(colors.circle1, 0.4)
              : isThinking ? hexToRgba(colors.circle2, 0.35)
              : hexToRgba(colors.circle4, 0.25)
            }`,
            animation: isSpeaking
              ? "orb-ring-pulse 1.5s ease-in-out infinite"
              : isListening
              ? "orb-ring-pulse 2s ease-in-out infinite"
              : isThinking
              ? "orb-thinking-ring 2s linear infinite"
              : "none",
          }}
        />
      )}

      {/* Outer glow ring for speaking */}
      {size >= 64 && isSpeaking && (
        <div
          className="absolute rounded-full pointer-events-none"
          style={{
            inset: -12,
            border: `1px solid ${hexToRgba(colors.circle2, 0.25)}`,
            animation: "orb-ring-pulse 2s ease-in-out infinite 0.5s",
          }}
        />
      )}

      <div
        className={`relative rounded-full overflow-hidden ${speakingClass} ${className}`}
        style={{
          width: size,
          height: size,
          backgroundColor: colors.bg,
          animation: isSpeaking
            ? `${colorAnimation}, orb-morph 2s ease-in-out infinite`
            : colorAnimation,
          boxShadow: stateGlow,
          transition: "box-shadow 0.5s ease-out",
          opacity: connected ? 1 : 0.4,
        }}
        aria-hidden="true"
      >
        {/* Glow ring when speaking */}
        {isSpeaking && (
          <>
            <div
              className="absolute inset-0 rounded-full orb-glow-ring"
              style={{
              background:
                  `radial-gradient(circle, transparent 40%, ${hexToRgba(colors.circle1, 0.3)} 70%, transparent 100%)`,
              }}
            />
            <div
              className="absolute inset-0 rounded-full orb-glow-ring-2"
              style={{
                background:
                  `radial-gradient(circle, transparent 50%, ${hexToRgba(colors.circle2, 0.25)} 80%, transparent 100%)`,
              }}
            />
          </>
        )}

        {/* Listening glow */}
        {isListening && (
          <div
            className="absolute inset-0 rounded-full"
            style={{
              background:
                `radial-gradient(circle, ${hexToRgba(colors.circle1, 0.2)} 0%, transparent 70%)`,
              animation: "orb-glow-pulse 2s ease-in-out infinite",
            }}
          />
        )}

        {/* Thinking glow */}
        {isThinking && (
          <div
            className="absolute inset-0 rounded-full"
            style={{
              background:
                `conic-gradient(from 0deg, transparent, ${hexToRgba(colors.circle4, 0.2)}, transparent, ${hexToRgba(colors.circle2, 0.15)}, transparent)`,
              animation: "orb-thinking-conic 2s linear infinite",
            }}
          />
        )}

        {/* Blur container */}
        <div
          className="absolute inset-0 flex items-center justify-center"
          style={
            {
              "--orb-blur": `${isSpeaking ? blurAmount * 1.6 : blurAmount}px`,
              animation: useCustomPalette
                ? isSpeaking
                  ? "orb-custom-blur-surge 1.1s ease-in-out infinite"
                  : "orb-custom-blur-drift 2.8s ease-in-out infinite"
                : isSpeaking
                ? "orb-hue-rotate-blur 2s linear infinite reverse"
                : "orb-hue-rotate-blur 6s linear infinite reverse",
              transition: "filter 0.3s ease-out",
            } as React.CSSProperties
          }
        >
          {[circle1Size, circle2Size, circle3Size, circle4Size, circle5Size].map(
            (s, i) => (
              <div
                key={i}
                className={`${circleClass(i + 1)} absolute rounded-full`}
                style={{
                  width: s,
                  height: s,
                  opacity: isSpeaking ? 1 : 0.85,
                  backgroundColor: Object.values(colors)[i + 1],
                  transition: "opacity 0.3s ease-out",
                }}
              />
            )
          )}
        </div>

        {/* Specular highlight */}
        <div
          className="absolute inset-0 rounded-full pointer-events-none"
          style={{
            background: isSpeaking
              ? "linear-gradient(to bottom, rgba(255,255,255,0.5) 0%, transparent 60%)"
              : "linear-gradient(to bottom, rgba(255,255,255,0.25) 0%, transparent 100%)",
          }}
        />

        {/* Inner glow */}
        {isSpeaking && (
          <div
            className="absolute inset-0 rounded-full pointer-events-none orb-inner-glow"
            style={{
              background:
                "radial-gradient(circle at center, rgba(255,255,255,0.35) 0%, transparent 60%)",
            }}
          />
        )}
      </div>

      {/* State label for large orbs */}
      {showStateLabel && size >= 120 && state !== "idle" && (
        <div
          className="absolute -bottom-6 left-1/2 -translate-x-1/2 text-[10px] font-mono tracking-wider uppercase whitespace-nowrap"
          style={{
            color: isSpeaking
              ? hexToRgba(colors.circle4, 0.75)
              : isListening
              ? hexToRgba(colors.circle1, 0.75)
              : isThinking
              ? hexToRgba(colors.circle2, 0.75)
              : "rgba(255, 255, 255, 0.3)",
          }}
        >
          {state}
        </div>
      )}
    </div>
  )
}
