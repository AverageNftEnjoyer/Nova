import Image from "next/image"
import type { ComponentProps, SVGProps } from "react"
import { Claude, Gemini, OpenAI, XAI } from "@lobehub/icons"

interface BraveIconProps {
  className?: string
}

export function BraveIcon({ className = "w-4 h-4" }: BraveIconProps) {
  return <Image src="/images/brave.svg" alt="Brave" width={16} height={16} className={className} unoptimized />
}

export function CoinbaseIcon({ className = "w-4 h-4" }: BraveIconProps) {
  return <Image src="/images/coinbase.svg" alt="Coinbase" width={16} height={16} className={className} unoptimized />
}

export function SpotifyIcon({ className = "w-4 h-4" }: BraveIconProps) {
  return <Image src="/images/spotify.svg" alt="Spotify" width={16} height={16} className={className} unoptimized />
}

export function ClaudeIcon(props: ComponentProps<typeof Claude.Color>) {
  return <Claude.Color {...props} />
}

export function DiscordIcon(props: SVGProps<SVGSVGElement>) {
  return (
    <svg viewBox="0 -28.5 256 256" fill="none" aria-hidden="true" {...props}>
      <path
        d="M216.856 16.597C200.285 8.843 182.566 3.208 164.042 0c-2.276 4.113-4.934 9.645-6.766 14.046-19.692-2.961-39.203-2.961-58.533 0C96.911 9.645 94.193 4.113 91.897 0 73.353 3.208 55.613 8.864 39.042 16.638 5.618 67.147-3.443 116.401 1.087 164.956c22.169 16.555 43.653 26.612 64.775 33.193 5.215-7.177 9.866-14.807 13.873-22.848-7.631-2.9-14.94-6.478-21.846-10.632 1.832-1.357 3.624-2.776 5.356-4.236 42.122 19.702 87.89 19.702 129.509 0 1.752 1.46 3.544 2.879 5.356 4.236-6.926 4.175-14.256 7.753-21.887 10.653 4.007 8.02 8.638 15.67 13.873 22.848 21.142-6.581 42.646-16.637 64.815-33.213 5.316-56.288-9.081-105.09-38.056-148.359ZM85.474 135.095c-12.645 0-23.015-11.805-23.015-26.18S72.608 82.715 85.474 82.715s23.236 11.804 23.015 26.2c.02 14.375-10.148 26.18-23.015 26.18Zm85.051 0c-12.645 0-23.014-11.805-23.014-26.18s10.148-26.2 23.014-26.2 23.236 11.804 23.015 26.2c0 14.375-10.148 26.18-23.015 26.18Z"
        fill="#5865F2"
      />
    </svg>
  )
}

export function GeminiIcon(props: ComponentProps<typeof Gemini.Color>) {
  return <Gemini.Color {...props} />
}

export function GmailIcon(props: SVGProps<SVGSVGElement>) {
  return (
    <svg viewBox="0 -31.5 256 256" fill="none" aria-hidden="true" {...props}>
      <path d="M58.182 192.05V93.14L27.507 65.077 0 49.504V174.595c0 9.658 7.825 17.455 17.455 17.455h40.727Z" fill="#4285F4" />
      <path d="M197.818 192.05h40.727c9.658 0 17.455-7.825 17.455-17.455V49.504l-31.156 17.838-27.026 25.798V192.05Z" fill="#34A853" />
      <path d="m58.182 93.14-4.174-38.647 4.174-36.989L128 69.868l69.818-52.364 4.67 34.992-4.67 40.644L128 145.504 58.182 93.14Z" fill="#EA4335" />
      <path d="M197.818 17.504V93.14L256 49.504V26.231c0-21.585-24.64-33.89-41.89-20.945l-16.292 12.218Z" fill="#FBBC04" />
      <path d="m0 49.504 26.759 20.069L58.182 93.14V17.504L41.89 5.286C24.611-7.66 0 4.646 0 26.231v23.273Z" fill="#C5221F" />
    </svg>
  )
}

interface GmailCalendarIconProps {
  className?: string
  size?: number
}
export function GmailCalendarIcon({ className = "w-4 h-4", size }: GmailCalendarIconProps) {
  const px = size ?? 16
  return (
    <Image
      src="/images/gcalendar.svg"
      alt="Google Calendar"
      width={px}
      height={px}
      className={className}
      unoptimized
    />
  )
}

type OpenAIIconProps = Omit<ComponentProps<typeof OpenAI>, "size"> & {
  size?: number
}

export function OpenAIIcon({ size = 18, ...props }: OpenAIIconProps) {
  return <OpenAI size={size} {...props} style={{ ...(props.style || {}), color: "#000000" }} />
}

export function TelegramIcon(props: SVGProps<SVGSVGElement>) {
  return (
    <svg viewBox="0 0 100 100" fill="none" aria-hidden="true" {...props}>
      <path
        d="M88.723 12.142C76.419 17.238 23.661 39.091 9.084 45.047c-9.776 3.815-4.053 7.392-4.053 7.392s8.345 2.861 15.499 5.007c7.153 2.146 10.968-.238 10.968-.238l33.62-22.652c11.922-8.107 9.061-1.431 6.199 1.431-6.199 6.2-16.452 15.975-25.036 23.844-3.815 3.338-1.908 6.199-.238 7.63 6.199 5.246 23.129 15.976 24.082 16.691 5.037 3.566 14.945 8.699 16.452-2.146 0 0 5.961-37.435 5.961-37.435 1.908-12.637 3.815-24.321 4.053-27.659.716-8.107-7.868-4.769-7.868-4.769Z"
        fill="#1B92D1"
      />
    </svg>
  )
}

export function XAIIcon(props: ComponentProps<typeof XAI>) {
  return <XAI {...props} />
}
