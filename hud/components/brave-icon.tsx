import Image from "next/image"

interface BraveIconProps {
  className?: string
}

export function BraveIcon({ className = "w-4 h-4" }: BraveIconProps) {
  return (
    <Image
      src="/images/brave.svg"
      alt="Brave"
      width={16}
      height={16}
      className={className}
      unoptimized
    />
  )
}
