import type React from "react"
import type { Metadata, Viewport } from "next"
import { Geist, Geist_Mono } from "next/font/google"
import { Analytics } from "@vercel/analytics/next"
import { ThemeProvider } from "@/lib/theme-context"
import { AccentProvider } from "@/lib/accent-context"
import "./globals.css"

const geistSans = Geist({ subsets: ["latin"], variable: "--font-geist-sans" })
const geistMono = Geist_Mono({ subsets: ["latin"], variable: "--font-geist-mono" })

export const metadata: Metadata = {
  title: "Nova",
  description: "Nova AI Assistant",
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
      <head>
        <script
          dangerouslySetInnerHTML={{
            __html: `(function(){try{var raw=localStorage.getItem("nova_user_settings");if(!raw)return;var parsed=JSON.parse(raw);var setting=parsed&&parsed.app&&parsed.app.theme?parsed.app.theme:"dark";var resolved=setting==="system"?((window.matchMedia&&window.matchMedia("(prefers-color-scheme: dark)").matches)?"dark":"light"):setting;document.documentElement.classList.remove("dark","light");document.documentElement.classList.add(resolved==="light"?"light":"dark")}catch(e){}})()`,
          }}
        />
      </head>
      <body className={`${geistSans.variable} ${geistMono.variable} font-sans antialiased bg-page`}>
        <ThemeProvider>
          <AccentProvider>
            {children}
          </AccentProvider>
        </ThemeProvider>
        <Analytics />
      </body>
    </html>
  )
}
