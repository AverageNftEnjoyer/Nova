import type React from "react"
import type { Metadata, Viewport } from "next"
import { Geist, Geist_Mono } from "next/font/google"
import Script from "next/script"
import { ThemeProvider } from "@/lib/context/theme-context"
import { AccentProvider } from "@/lib/context/accent-context"
import { PageActiveController } from "@/components/background/page-active-controller"
import { UiStorageGate } from "@/components/settings/ui-storage-gate"
import { Toaster } from "@/components/ui/toast"
import { AppShell } from "@/components/shell/app-shell"
import "./globals.css"

const geistSans = Geist({ subsets: ["latin"], variable: "--font-geist-sans" })
const geistMono = Geist_Mono({ subsets: ["latin"], variable: "--font-geist-mono" })

export const metadata: Metadata = {
  title: "Nova",
  description: "Nova: local-first agent platform",
  icons: {
    icon: {
      url: "/images/nova.svg",
      type: "image/svg+xml",
    },
  },
}

export const viewport: Viewport = {
  // Matches --canvas in app/styles/theme.css.
  themeColor: [
    { media: "(prefers-color-scheme: dark)", color: "#0c0d10" },
    { media: "(prefers-color-scheme: light)", color: "#f7f7f8" },
  ],
  width: "device-width",
  initialScale: 1,
  maximumScale: 1,
  userScalable: false,
}

// Runs before paint: applies the saved theme and accent so the first frame already has the right tokens.
const THEME_BOOTSTRAP = `(function(){try{var d=document.documentElement;var uid=localStorage.getItem("nova_active_user_id")||"local-user";var raw=localStorage.getItem("nova_user_settings:"+uid);if(!raw)return;var app=(JSON.parse(raw)||{}).app||{};var setting=app.theme||"dark";var resolved=setting==="system"?((window.matchMedia&&window.matchMedia("(prefers-color-scheme: dark)").matches)?"dark":"light"):setting;d.classList.remove("dark","light");d.classList.add(resolved==="light"?"light":"dark");if(typeof app.accentColor==="string")d.dataset.accent=app.accentColor;var fs=app.fontSize==="small"?0.92:app.fontSize==="large"?1.12:1;d.style.setProperty("--font-scale",String(fs))}catch(e){}})()`

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode
}>) {
  return (
    <html lang="en" className={`dark ${geistSans.variable} ${geistMono.variable}`} suppressHydrationWarning>
      <body className="bg-canvas font-sans text-fg antialiased">
        <Script id="nova-theme-bootstrap" strategy="beforeInteractive">
          {THEME_BOOTSTRAP}
        </Script>
        <UiStorageGate>
          <ThemeProvider>
            <AccentProvider>
              <PageActiveController />
              <AppShell>{children}</AppShell>
              <Toaster />
            </AccentProvider>
          </ThemeProvider>
        </UiStorageGate>
      </body>
    </html>
  )
}
