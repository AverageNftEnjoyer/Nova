import type React from "react"
import type { Metadata, Viewport } from "next"
import { Geist, Geist_Mono, Atkinson_Hyperlegible_Next, Silkscreen } from "next/font/google"
import Script from "next/script"
import { ThemeProvider } from "@/lib/context/theme-context"
import { AccentProvider } from "@/lib/context/accent-context"
import { AppBackgroundLayer } from "@/components/background/app-background-layer"
import { PageActiveController } from "@/components/background/page-active-controller"
import { UiStorageGate } from "@/components/settings/ui-storage-gate"
import "./globals.css"

const geistSans = Geist({ subsets: ["latin"], variable: "--font-geist-sans" })
const geistMono = Geist_Mono({ subsets: ["latin"], variable: "--font-geist-mono" })
// Home city faces: Atkinson Hyperlegible Next (open letterforms, built for legibility) for every sentence and form field,
// Silkscreen (chunky pixel caps) only for short titles, buttons, numbers and the wordmark.
const atkinson = Atkinson_Hyperlegible_Next({ subsets: ["latin"], variable: "--font-pixel" })
const silkscreen = Silkscreen({ subsets: ["latin"], weight: ["400", "700"], variable: "--font-pixel-display" })

export const metadata: Metadata = {
  title: "U.B Agents",
  description: "U.B Agents AI Assistant",
  icons: {
    icon: {
      url: "/images/nova.svg",
      type: "image/svg+xml",
    },
  },
}

export const viewport: Viewport = {
  themeColor: "#0a0a0f",
  width: "device-width",
  initialScale: 1,
  maximumScale: 1,
  userScalable: false,
}

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode
}>) {
  return (
    <html lang="en" className="dark" suppressHydrationWarning>
      <body className={`${geistSans.variable} ${geistMono.variable} ${atkinson.variable} ${silkscreen.variable} font-sans antialiased bg-page`}>
        <Script id="nova-theme-bootstrap" strategy="beforeInteractive">
          {`(function(){try{var uid=localStorage.getItem("nova_active_user_id")||"local-user";var raw=localStorage.getItem("nova_user_settings:"+uid);if(!raw)return;var parsed=JSON.parse(raw);var setting=parsed&&parsed.app&&parsed.app.theme?parsed.app.theme:"dark";var resolved=setting==="system"?((window.matchMedia&&window.matchMedia("(prefers-color-scheme: dark)").matches)?"dark":"light"):setting;document.documentElement.classList.remove("dark","light");document.documentElement.classList.add(resolved==="light"?"light":"dark")}catch(e){}})()`}
        </Script>
        <UiStorageGate>
          <ThemeProvider>
            <AccentProvider>
              <PageActiveController />
              <AppBackgroundLayer />
              <div className="relative z-10">
                {children}
              </div>
            </AccentProvider>
          </ThemeProvider>
        </UiStorageGate>
      </body>
    </html>
  )
}
