"use client"

import { FormEvent, useCallback, useEffect, useMemo, useRef, useState } from "react"
import type React from "react"
import Image from "next/image"
import { useRouter } from "next/navigation"
import {
  ArrowRight,
  BadgeCheck,
  Eye,
  EyeOff,
  KeyRound,
  LifeBuoy,
  LockKeyhole,
  Mail,
  PanelsTopLeft,
  Sparkles,
  UserPlus,
} from "lucide-react"
import { useSpotlightEffect } from "@/app/integrations/hooks"
import { NovaOrbIndicator } from "@/components/chat/nova-orb-indicator"
import { setActiveUserId } from "@/lib/auth/active-user"
import { loginDebugBump, loginDebugEvent, loginDebugSnapshot } from "@/lib/auth/login-debug"
import { useTheme } from "@/lib/context/theme-context"
import { NOVA_VERSION } from "@/lib/meta/version"
import {
  ORB_COLORS,
  USER_SETTINGS_UPDATED_EVENT,
  loadUserSettings,
  saveUserSettings,
  type OrbColor,
} from "@/lib/settings/userSettings"
import { hasSupabaseClientConfig, supabaseBrowser } from "@/lib/supabase/browser"

type AuthMode = "signin" | "signup" | "forgot" | "reset"

function sanitizeNextPath(raw: string | null): string {
  const value = String(raw || "").trim()
  if (!value.startsWith("/")) return "/boot-right"
  if (value.startsWith("//")) return "/boot-right"
  return value
}

function hexToRgbTriplet(hex: string): string {
  const clean = hex.replace("#", "")
  const full = clean.length === 3 ? clean.split("").map((value) => value + value).join("") : clean
  const parsed = Number.parseInt(full, 16)
  const red = (parsed >> 16) & 255
  const green = (parsed >> 8) & 255
  const blue = parsed & 255
  return `${red}, ${green}, ${blue}`
}

async function ensureSupabaseSessionPersisted() {
  if (!hasSupabaseClientConfig || !supabaseBrowser) return
  await supabaseBrowser.auth.getSession()
}

function buildWorkspaceContextSyncPayload() {
  const settings = loadUserSettings()
  return {
    assistantName: settings.personalization.assistantName,
    userName: settings.profile.name,
    nickname: settings.personalization.nickname,
    occupation: settings.personalization.occupation,
    preferredLanguage: settings.personalization.preferredLanguage,
    communicationStyle: settings.personalization.communicationStyle,
    tone: settings.personalization.tone,
    characteristics: settings.personalization.characteristics,
    customInstructions: settings.personalization.customInstructions,
    interests: settings.personalization.interests,
  }
}

function resolveSupabaseProfileName(rawUser: unknown): string {
  if (!rawUser || typeof rawUser !== "object") return ""
  const user = rawUser as { user_metadata?: Record<string, unknown> | null; email?: unknown; id?: unknown }
  const meta = user.user_metadata && typeof user.user_metadata === "object"
    ? user.user_metadata
    : {}
  const candidates = [
    meta.full_name,
    meta.name,
    meta.display_name,
    meta.preferred_name,
  ]
  for (const candidate of candidates) {
    const value = String(candidate || "").trim()
    if (value) return value.slice(0, 80)
  }
  const email = String(user.email || "").trim().toLowerCase()
  if (email.includes("@")) {
    const local = email.slice(0, email.indexOf("@")).replace(/[._+-]+/g, " ").trim()
    if (local) return local.slice(0, 80)
  }
  const userId = String(user.id || "").trim().replace(/[^a-z0-9_-]/gi, "")
  if (userId) return `user-${userId.slice(0, 12)}`
  return "user"
}

export default function LoginPage() {
  const router = useRouter()
  const { theme } = useTheme()
  const shellRef = useRef<HTMLDivElement | null>(null)
  const debugMountIdRef = useRef(Math.random().toString(36).slice(2, 8))
  const googlePopupRef = useRef<Window | null>(null)
  const googlePopupPollRef = useRef<number | null>(null)
  const [orbColor, setOrbColor] = useState<OrbColor>("violet")
  const [debugEnabled, setDebugEnabled] = useState(false)
  const [debugPanel, setDebugPanel] = useState(() => loginDebugSnapshot())
  const [email, setEmail] = useState("")
  const [name, setName] = useState("")
  const [password, setPassword] = useState("")
  const [confirmPassword, setConfirmPassword] = useState("")
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState("")
  const [notice, setNotice] = useState("")
  const [mode, setMode] = useState<AuthMode>("signin")
  const [nextPath, setNextPath] = useState("/boot-right")
  const [showPassword, setShowPassword] = useState(false)
  const [showConfirmPassword, setShowConfirmPassword] = useState(false)

  const isLight = theme === "light"
  const orbPalette = ORB_COLORS[orbColor]

  useSpotlightEffect(true, [{ ref: shellRef, showSpotlightCore: false, enableParticles: false, directHoverOnly: true }], [isLight, mode])

  const navigatePostAuth = useCallback(
    (next: string) => {
      const target = `/boot-right?next=${encodeURIComponent(next || "/home")}`
      router.replace(target)
    },
    [router],
  )

  const syncWorkspaceProfileFromSupabaseSession = useCallback(async () => {
    if (!hasSupabaseClientConfig || !supabaseBrowser) {
      throw new Error("Supabase client is not configured for profile sync.")
    }
    const { data } = await supabaseBrowser.auth.getSession()
    const accessToken = String(data.session?.access_token || "").trim()
    const userId = String(data.session?.user?.id || "").trim()
    if (!accessToken || !userId) {
      throw new Error("Authenticated Supabase session required for workspace profile sync.")
    }
    setActiveUserId(userId)
    const supabaseProfileName = resolveSupabaseProfileName(data.session?.user || null)
    const current = loadUserSettings()
    saveUserSettings({
      ...current,
      profile: {
        ...current.profile,
        name: supabaseProfileName,
      },
    })
    const res = await fetch("/api/workspace/context-sync", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        authorization: `Bearer ${accessToken}`,
      },
      body: JSON.stringify(buildWorkspaceContextSyncPayload()),
      keepalive: true,
    })
    if (!res.ok) {
      const text = await res.text()
      let message = `Workspace profile sync failed (${res.status}).`
      if (text) {
        try {
          const payload = JSON.parse(text) as { error?: unknown }
          const apiError = String(payload.error || "").trim()
          if (apiError) message = apiError
        } catch {
          message = text.slice(0, 240)
        }
      }
      throw new Error(message)
    }
  }, [])

  const syncOrbColor = useCallback(() => {
    const nextColor = loadUserSettings().app.orbColor
    setOrbColor(nextColor in ORB_COLORS ? nextColor : "violet")
  }, [])

  function switchMode(nextMode: AuthMode) {
    setMode(nextMode)
    setEmail("")
    setName("")
    setPassword("")
    setConfirmPassword("")
    setShowPassword(false)
    setShowConfirmPassword(false)
    setError("")
    setNotice("")
  }

  if (debugEnabled) loginDebugBump("page.render")

  useEffect(() => {
    syncOrbColor()
    window.addEventListener(USER_SETTINGS_UPDATED_EVENT, syncOrbColor as EventListener)
    return () => window.removeEventListener(USER_SETTINGS_UPDATED_EVENT, syncOrbColor as EventListener)
  }, [syncOrbColor])

  useEffect(() => {
    const enabled = new URLSearchParams(window.location.search).get("debug") === "1"
    setDebugEnabled(enabled)
  }, [])

  useEffect(() => {
    if (!debugEnabled) return
    const mountId = debugMountIdRef.current
    loginDebugBump("page.mount")
    loginDebugEvent("login-page", "mount", `id=${mountId}`)
    const timer = window.setInterval(() => setDebugPanel(loginDebugSnapshot()), 250)
    return () => {
      window.clearInterval(timer)
      loginDebugBump("page.unmount")
      loginDebugEvent("login-page", "unmount", `id=${mountId}`)
    }
  }, [debugEnabled])

  useEffect(() => {
    const params = new URLSearchParams(window.location.search)
    const next = sanitizeNextPath(params.get("next"))
    const requestedMode = String(params.get("mode") || "").trim()
    const allowLoginWhileAuthed = requestedMode === "signup" || params.get("switch") === "1"
    const isGoogleOauthPopup = params.get("oauth") === "1" && Boolean(window.opener && window.opener !== window)

    if (requestedMode === "reset") switchMode("reset")
    else if (requestedMode === "signup") switchMode("signup")
    setNextPath(next)

    if (!hasSupabaseClientConfig || !supabaseBrowser) {
      if (debugEnabled) loginDebugEvent("login-page", "supabase:missing")
      setError("Authentication is not configured for this deployment.")
      return
    }

    void supabaseBrowser.auth.getSession().then(({ data }) => {
      if (debugEnabled) loginDebugEvent("login-page", "getSession", `authed=${data.session?.user ? "1" : "0"}`)
      setActiveUserId(data.session?.user?.id || null)

      if (data.session?.user && isGoogleOauthPopup) {
        try {
          window.opener?.postMessage(
            {
              type: "nova:google-oauth",
              status: "success",
              nextPath: next,
              userId: data.session.user.id,
            },
            window.location.origin,
          )
        } catch {
          // no-op
        }
        try {
          window.close()
        } catch {
          // no-op
        }
        return
      }

      if (data.session?.user && !allowLoginWhileAuthed) {
        void (async () => {
          try {
            await syncWorkspaceProfileFromSupabaseSession()
            router.replace(next)
          } catch (syncError) {
            setError(syncError instanceof Error ? syncError.message : "Failed to sync workspace profile context.")
          }
        })()
      }
    })
  }, [debugEnabled, router, syncWorkspaceProfileFromSupabaseSession])

  useEffect(() => {
    const onMessage = (event: MessageEvent) => {
      if (event.origin !== window.location.origin) return
      const payload = event.data as
        | { type?: string; status?: "success" | "error"; nextPath?: string; userId?: string; message?: string }
        | null
      if (!payload || payload.type !== "nova:google-oauth") return

      if (googlePopupPollRef.current !== null) {
        window.clearInterval(googlePopupPollRef.current)
        googlePopupPollRef.current = null
      }
      if (googlePopupRef.current && !googlePopupRef.current.closed) {
        try {
          googlePopupRef.current.close()
        } catch {
          // no-op
        }
      }
      googlePopupRef.current = null

      if (payload.status === "success") {
        if (payload.userId) setActiveUserId(payload.userId)
        void ensureSupabaseSessionPersisted().then(async () => {
          try {
            await syncWorkspaceProfileFromSupabaseSession()
            navigatePostAuth(payload.nextPath || nextPath)
          } catch (syncError) {
            setBusy(false)
            setError(syncError instanceof Error ? syncError.message : "Failed to sync workspace profile context.")
          }
        })
      } else {
        setBusy(false)
        setError(payload.message || "Google sign-in failed.")
      }
    }

    window.addEventListener("message", onMessage)
    return () => window.removeEventListener("message", onMessage)
  }, [navigatePostAuth, nextPath, syncWorkspaceProfileFromSupabaseSession])

  useEffect(() => {
    return () => {
      if (googlePopupPollRef.current !== null) {
        window.clearInterval(googlePopupPollRef.current)
      }
      googlePopupPollRef.current = null
      googlePopupRef.current = null
    }
  }, [])

  async function onSubmit(event: FormEvent) {
    event.preventDefault()
    setError("")
    setNotice("")
    const trimmedEmail = email.trim()
    const trimmedName = name.trim()

    if (mode === "signin") {
      if (trimmedEmail && !password) {
        setError("Missing Password")
        return
      }
      if (!trimmedEmail && password) {
        setError("Missing Email")
        return
      }
      if (!trimmedEmail || !password) {
        setError("Incorrect Information Please Try Again")
        return
      }
    }

    if (mode === "signup") {
      if (!trimmedName || !trimmedEmail || !password || !confirmPassword) {
        setError("Incorrect Information Please Try Again")
        return
      }
      if (password !== confirmPassword) {
        setError("Passwords do not match.")
        return
      }
    }

    if (mode === "forgot" && !trimmedEmail) {
      setError("Missing Email")
      return
    }

    if (mode === "reset" && !password) {
      setError("Missing Password")
      return
    }

    setBusy(true)

    try {
      if (!hasSupabaseClientConfig || !supabaseBrowser) {
        throw new Error("Authentication is not configured for this deployment.")
      }

      if (mode === "forgot") {
        if (debugEnabled) loginDebugEvent("login-page", "submit:forgot")
        const redirectTo = `${window.location.origin}/login?mode=reset&next=${encodeURIComponent(nextPath)}`
        const { error: resetError } = await supabaseBrowser.auth.resetPasswordForEmail(trimmedEmail, { redirectTo })
        if (resetError) throw resetError
        setNotice("Password reset link sent. Check your email.")
        return
      }

      if (mode === "reset") {
        if (debugEnabled) loginDebugEvent("login-page", "submit:reset")
        const { data } = await supabaseBrowser.auth.getSession()
        if (!data.session?.user) throw new Error("Open the password reset link from your email, then set your new password.")
        const { error: updateError } = await supabaseBrowser.auth.updateUser({ password })
        if (updateError) throw updateError
        setNotice("Password updated. Sign in with your new password.")
        switchMode("signin")
        return
      }

      if (mode === "signup") {
        if (debugEnabled) loginDebugEvent("login-page", "submit:signup")
        await supabaseBrowser.auth.signOut({ scope: "local" })
        setActiveUserId(null)
        const { data: signUpData, error: signUpError } = await supabaseBrowser.auth.signUp({
          email: trimmedEmail,
          password,
          ...(trimmedName ? { options: { data: { full_name: trimmedName } } } : {}),
        })
        if (signUpError) throw signUpError

        let authedUserId = signUpData.session?.user?.id || null
        if (!signUpData.session) {
          const { data: autoSignIn, error: autoSignInError } = await supabaseBrowser.auth.signInWithPassword({
            email: trimmedEmail,
            password,
          })
          if (!autoSignInError && autoSignIn.session?.user?.id) {
            authedUserId = autoSignIn.session.user.id
          }
        }

        setActiveUserId(authedUserId || signUpData.user?.id || null)

        if (trimmedName) {
          const current = loadUserSettings()
          saveUserSettings({
            ...current,
            profile: {
              ...current.profile,
              name: trimmedName,
              accessTier: "Model Unset",
            },
          })
        }

        if (authedUserId) {
          await ensureSupabaseSessionPersisted()
          await syncWorkspaceProfileFromSupabaseSession()
          navigatePostAuth(nextPath)
          return
        }

        setNotice("Account created. If email confirmation is enabled, verify your email first.")
      } else {
        if (debugEnabled) loginDebugEvent("login-page", "submit:signin")
        await supabaseBrowser.auth.signOut({ scope: "local" })
        setActiveUserId(null)
        const { data: signInData, error: signInError } = await supabaseBrowser.auth.signInWithPassword({
          email: trimmedEmail,
          password,
        })
        if (signInError) throw signInError
        setActiveUserId(signInData.user?.id || null)
        await ensureSupabaseSessionPersisted()
        await syncWorkspaceProfileFromSupabaseSession()
        navigatePostAuth(nextPath)
      }
    } catch (err) {
      if (debugEnabled) loginDebugEvent("login-page", "submit:error", err instanceof Error ? err.message : "unknown")
      const message = err instanceof Error ? err.message : ""
      const normalized = message.toLowerCase()
      if (mode === "signin" && normalized.includes("invalid login credentials")) {
        setError("No Account Found with Email")
      } else if (!message && mode === "signin") {
        setError("Incorrect Information Please Try Again")
      } else {
        setError(message || "Authentication failed.")
      }
    } finally {
      setBusy(false)
    }
  }

  async function onGoogleAuth() {
    setError("")
    setNotice("")
    setBusy(true)

    try {
      if (!hasSupabaseClientConfig || !supabaseBrowser) {
        throw new Error("Authentication is not configured for this deployment.")
      }

      const redirectTo = `${window.location.origin}/login?next=${encodeURIComponent(nextPath)}&oauth=1`
      const { data, error: oauthError } = await supabaseBrowser.auth.signInWithOAuth({
        provider: "google",
        options: { redirectTo, skipBrowserRedirect: true },
      })
      if (oauthError) throw oauthError

      const authUrl = String(data?.url || "").trim()
      if (!authUrl) throw new Error("Google sign-in did not return an authorization URL.")

      const width = 420
      const height = 620
      const left = Math.max(0, Math.floor(window.screenX + (window.outerWidth - width) / 2))
      const top = Math.max(0, Math.floor(window.screenY + (window.outerHeight - height) / 2))
      const popup = window.open(
        authUrl,
        "nova-google-oauth",
        `popup=yes,width=${width},height=${height},left=${left},top=${top},resizable=yes,scrollbars=yes,toolbar=no,menubar=no,location=no,status=no`,
      )

      if (!popup) {
        const tab = window.open(authUrl, "_blank")
        if (!tab) throw new Error("Popup was blocked. Allow popups for Nova to continue with Google.")
        setBusy(false)
        setNotice("Google sign-in opened in a new tab. Complete auth there, then return.")
      } else {
        googlePopupRef.current = popup
        if (googlePopupPollRef.current !== null) {
          window.clearInterval(googlePopupPollRef.current)
        }
        googlePopupPollRef.current = window.setInterval(() => {
          const handle = googlePopupRef.current
          if (!handle || !handle.closed) return
          if (googlePopupPollRef.current !== null) {
            window.clearInterval(googlePopupPollRef.current)
            googlePopupPollRef.current = null
          }
          googlePopupRef.current = null
          setBusy(false)
        }, 400)
      }

      if (debugEnabled) loginDebugEvent("login-page", "oauth:google:start")
    } catch (err) {
      if (debugEnabled) loginDebugEvent("login-page", "oauth:google:error", err instanceof Error ? err.message : "unknown")
      setError(err instanceof Error ? err.message : "Google sign-in failed.")
      setBusy(false)
    }
  }

  const cardTitle =
    mode === "signup"
      ? "Provision Your Nova Identity"
      : mode === "forgot"
        ? "Recover Your Access"
        : mode === "reset"
          ? "Seal a New Credential"
          : "Resume Your Session"

  const cardSubtitle =
    mode === "signup"
      ? "Create the profile that unlocks your Nova workspace."
      : mode === "forgot"
        ? "We will send a secure recovery link to your registered email."
        : mode === "reset"
          ? "Set a new password and re-enter the shell."
          : "Authenticate to restore your Nova environment."

  const signInReady = email.trim().length > 0 && password.length > 0
  const signUpReady =
    name.trim().length > 0 &&
    email.trim().length > 0 &&
    password.length > 0 &&
    confirmPassword.length > 0 &&
    password === confirmPassword
  const forgotReady = email.trim().length > 0
  const resetReady = password.length > 0
  const submitReady = mode === "signup" ? signUpReady : mode === "forgot" ? forgotReady : mode === "reset" ? resetReady : signInReady
  const submitDisabled = busy || !submitReady
  const routeTarget = nextPath || "/home"

  const modeTag =
    mode === "signup"
      ? "Identity creation"
      : mode === "forgot"
        ? "Recovery request"
        : mode === "reset"
          ? "Credential refresh"
          : "Session restore"

  const modeSummary =
    mode === "signup"
      ? "Spin up a fresh Nova operator profile and carry your preferred identity into the shell."
      : mode === "forgot"
        ? "Issue a reset link without leaving the Nova environment or breaking session routing."
        : mode === "reset"
          ? "Finalize the recovery flow and return with the same post-auth route target."
          : "Restore your workstation, conversation routing, and user-scoped shell state."

  const supportTitle =
    mode === "signup"
      ? "What gets configured"
      : mode === "forgot"
        ? "Recovery path"
        : mode === "reset"
          ? "Reset safeguards"
          : "Why this stays inside Nova"

  const supportBody =
    mode === "signup"
      ? "Nova writes your profile name into user-scoped settings after account creation and preserves the normal boot routing."
      : mode === "forgot"
        ? "The reset email points back into `/login` with reset mode intact so the user never falls into a detached provider screen."
        : mode === "reset"
          ? "Password updates require the active reset session from the email link before Nova accepts the new credential."
          : "Auth stays aligned with the same orb palette, spotlight surface, and boot-right redirect path the rest of the HUD uses."

  const sessionFlow = useMemo(
    () => [
      mode === "signin"
        ? { title: "Authenticate", body: "Validate your email/password or continue with Google.", icon: LockKeyhole }
        : mode === "signup"
          ? { title: "Create identity", body: "Provision credentials and attach your Nova profile name.", icon: UserPlus }
          : mode === "forgot"
            ? { title: "Request recovery", body: "Issue a secure reset link to the email on file.", icon: Mail }
            : { title: "Confirm reset session", body: "Open the recovery link first, then set the new credential.", icon: KeyRound },
      { title: "Persist session", body: "Nova syncs the browser session before handing control back to boot-right.", icon: BadgeCheck },
      { title: "Route into shell", body: `Resume the requested path at ${routeTarget}.`, icon: ArrowRight },
    ],
    [mode, routeTarget],
  )

  const accessCards = useMemo(
    () => [
      {
        title: "Nova shell styling",
        body: "Spotlight cards, orb tint, and module surfaces mirror Home, Chat, and Settings.",
        badge: "Visual parity",
        icon: Sparkles,
      },
      {
        title: "Session-safe routing",
        body: "Boot routing remains internal so auth transitions do not churn the whole app shell.",
        badge: routeTarget,
        icon: PanelsTopLeft,
      },
      {
        title: supportTitle,
        body: supportBody,
        badge: modeTag,
        icon: LifeBuoy,
      },
    ],
    [modeTag, routeTarget, supportBody, supportTitle],
  )

  const supportMetrics = [
    { label: "Return route", value: routeTarget },
    { label: "Auth surface", value: mode === "signin" || mode === "signup" ? "Password + Google" : "Email recovery" },
    { label: "Mode", value: modeTag },
  ]

  const panelStyle = {
    "--login-orb-rgb": hexToRgbTriplet(orbPalette.circle2),
    "--login-orb-rgb-soft": hexToRgbTriplet(orbPalette.circle4),
  } as React.CSSProperties

  const panelClass = isLight
    ? "home-module-surface home-module-surface--light rounded-[28px] border border-[#d7dfeb] bg-white/78 shadow-[0_28px_70px_-38px_rgba(15,23,42,0.28)] backdrop-blur-xl"
    : "home-module-surface rounded-[28px] border bg-black/45 shadow-[0_28px_80px_-40px_rgba(0,0,0,0.72)] backdrop-blur-xl"

  const subPanelClass = isLight
    ? "rounded-[22px] border border-[#d8e0eb] bg-white/82 shadow-[0_18px_40px_-30px_rgba(148,163,184,0.45)]"
    : "home-subpanel-surface rounded-[22px] border backdrop-blur-md"

  const inputShellClass = isLight
    ? "home-spotlight-card home-border-glow rounded-2xl border border-[#d8dfeb] bg-white/88"
    : "home-spotlight-card home-border-glow rounded-2xl border border-white/12 bg-black/24"

  const passwordShellClass = isLight
    ? "home-spotlight-card home-border-glow rounded-2xl border border-[#d8dfeb] bg-white/88"
    : "home-spotlight-card home-border-glow rounded-2xl border border-white/12 bg-black/28"

  const primaryActionClass = isLight
    ? "home-spotlight-card home-border-glow rounded-2xl border border-[#cfd7e5] bg-[#f7faff] text-slate-900 hover:bg-white"
    : "home-spotlight-card home-border-glow rounded-2xl border border-white/16 bg-white/8 text-white hover:bg-white/12"

  const secondaryActionClass = isLight
    ? "home-spotlight-card home-border-glow rounded-2xl border border-[#d2dae6] bg-white/84 text-slate-700 hover:text-slate-950"
    : "home-spotlight-card home-border-glow rounded-2xl border border-white/12 bg-black/20 text-slate-300 hover:text-white"

  const switchActionClass = isLight
    ? "home-spotlight-card home-border-glow rounded-2xl border border-[#d2dae6] bg-[#f8fbff] text-slate-700 hover:text-slate-950"
    : "home-spotlight-card home-border-glow rounded-2xl border border-white/12 bg-white/6 text-slate-300 hover:text-white"

  const tabButtonClass = (active: boolean) =>
    active
      ? isLight
        ? "home-spotlight-card rounded-2xl border border-[#cad5e4] bg-white text-slate-950 shadow-[0_12px_30px_-26px_rgba(15,23,42,0.38)]"
        : "home-spotlight-card rounded-2xl border border-white/18 bg-white/10 text-white"
      : isLight
        ? "home-spotlight-card rounded-2xl border border-transparent bg-transparent text-slate-500 hover:text-slate-900"
        : "home-spotlight-card rounded-2xl border border-transparent bg-transparent text-slate-400 hover:text-slate-100"

  return (
    <main className="relative z-10 min-h-dvh overflow-hidden bg-transparent px-4 py-5 text-slate-100 sm:px-6 sm:py-6 lg:px-8">
      <div
        ref={shellRef}
        style={panelStyle}
        className={`home-spotlight-shell relative mx-auto flex min-h-[calc(100dvh-2.5rem)] w-full max-w-[1380px] flex-col overflow-hidden ${panelClass}`}
      >
        <div
          className="pointer-events-none absolute inset-x-0 top-0 h-72 opacity-90"
          style={{
            background: isLight
              ? "linear-gradient(180deg, rgba(var(--login-orb-rgb),0.16) 0%, rgba(var(--login-orb-rgb-soft),0.08) 22%, transparent 76%)"
              : "linear-gradient(180deg, rgba(var(--login-orb-rgb),0.18) 0%, rgba(var(--login-orb-rgb-soft),0.1) 24%, transparent 78%)",
          }}
        />
        <div
          className="pointer-events-none absolute -left-16 top-14 h-56 w-56 rounded-full blur-3xl"
          style={{ background: "radial-gradient(circle, rgba(var(--login-orb-rgb-soft),0.18) 0%, rgba(var(--login-orb-rgb-soft),0) 72%)" }}
        />
        <div
          className="pointer-events-none absolute -right-16 bottom-10 h-72 w-72 rounded-full blur-3xl"
          style={{ background: "radial-gradient(circle, rgba(var(--login-orb-rgb),0.16) 0%, rgba(var(--login-orb-rgb),0) 76%)" }}
        />
        <div
          className="flex items-center justify-between gap-4 border-b px-5 py-4 sm:px-6 lg:px-8"
          style={{ borderColor: isLight ? "rgba(148,163,184,0.22)" : "rgba(255,255,255,0.08)" }}
        >
          <div className="flex min-w-0 items-center gap-3">
            <div className={`grid h-11 w-11 place-items-center rounded-2xl border ${isLight ? "border-[#d5deea] bg-white/90" : "border-white/12 bg-white/6"}`}>
              <NovaOrbIndicator palette={orbPalette} size={24} animated={busy} />
            </div>
            <div className="min-w-0">
              <div className={`text-[0.72rem] uppercase tracking-[0.28em] ${isLight ? "text-slate-500" : "text-slate-400"}`}>NovaOS Secure Access</div>
              <div className={`truncate text-sm ${isLight ? "text-slate-700" : "text-slate-200"}`}>Authentication, recovery, and shell routing in one surface</div>
            </div>
          </div>
          <div className="flex shrink-0 items-center gap-2 text-[11px] uppercase tracking-[0.22em]">
            <span className={`rounded-full border px-3 py-1.5 ${isLight ? "border-[#d4dbe7] bg-white/90 text-slate-600" : "border-white/12 bg-white/6 text-slate-300"}`}>{modeTag}</span>
            <span className={`rounded-full border px-3 py-1.5 ${isLight ? "border-[#d4dbe7] bg-white/90 text-slate-600" : "border-white/12 bg-white/6 text-slate-300"}`}>{NOVA_VERSION}</span>
          </div>
        </div>

        <div className="grid flex-1 gap-5 p-4 sm:p-5 lg:grid-cols-[minmax(0,1.08fr)_minmax(420px,0.92fr)] lg:gap-6 lg:p-6">
          <section className="order-2 flex min-h-0 flex-col gap-4 lg:order-1">
            <div className={`${subPanelClass} flex min-h-[260px] flex-col justify-between gap-5 p-5 sm:p-6`}>
              <div className="max-w-3xl">
                <div className={`mb-3 inline-flex items-center gap-2 rounded-full border px-3 py-1 text-[11px] uppercase tracking-[0.24em] ${isLight ? "border-[#d6deea] bg-white text-slate-500" : "border-white/12 bg-white/6 text-slate-300"}`}>
                  <Sparkles className="h-3.5 w-3.5" />
                  Nova Access Node
                </div>
                <h1 className={`max-w-4xl text-3xl font-semibold tracking-[-0.03em] sm:text-4xl lg:text-[3.3rem] ${isLight ? "text-slate-950" : "text-white"}`}>
                  {cardTitle}
                </h1>
                <p className={`mt-3 max-w-2xl text-sm leading-6 sm:text-base ${isLight ? "text-slate-600" : "text-slate-300"}`}>
                  {modeSummary}
                </p>
              </div>

              <div className="grid gap-3 sm:grid-cols-3">
                {supportMetrics.map((metric) => (
                  <div key={metric.label} className={`${isLight ? "border-[#d8dfeb] bg-[#f7faff]" : "border-white/10 bg-black/18"} home-spotlight-card rounded-2xl border px-4 py-3`}>
                    <div className={`text-[11px] uppercase tracking-[0.22em] ${isLight ? "text-slate-500" : "text-slate-400"}`}>{metric.label}</div>
                    <div className={`mt-2 truncate text-sm font-medium ${isLight ? "text-slate-900" : "text-slate-100"}`}>{metric.value}</div>
                  </div>
                ))}
              </div>
            </div>

            <div className="grid gap-4 xl:grid-cols-[minmax(0,0.95fr)_minmax(0,1.05fr)]">
              <div className={`${subPanelClass} p-5 sm:p-6`}>
                <div className={`mb-4 text-[11px] uppercase tracking-[0.24em] ${isLight ? "text-slate-500" : "text-slate-400"}`}>Flow Control</div>
                <div className="space-y-3">
                  {sessionFlow.map((step, index) => {
                    const Icon = step.icon
                    return (
                      <div key={step.title} className={`${isLight ? "border-[#d7dfeb] bg-[#f9fbff]" : "border-white/10 bg-black/18"} home-spotlight-card rounded-2xl border p-4`}>
                        <div className="flex items-start gap-3">
                          <div className={`grid h-10 w-10 shrink-0 place-items-center rounded-2xl border ${isLight ? "border-[#d5deea] bg-white" : "border-white/12 bg-white/6"}`}>
                            <Icon className={`h-4 w-4 ${isLight ? "text-slate-700" : "text-slate-200"}`} />
                          </div>
                          <div className="min-w-0">
                            <div className={`text-[11px] uppercase tracking-[0.22em] ${isLight ? "text-slate-500" : "text-slate-400"}`}>Step {index + 1}</div>
                            <div className={`mt-1 text-sm font-semibold ${isLight ? "text-slate-950" : "text-white"}`}>{step.title}</div>
                            <p className={`mt-1 text-sm leading-6 ${isLight ? "text-slate-600" : "text-slate-300"}`}>{step.body}</p>
                          </div>
                        </div>
                      </div>
                    )
                  })}
                </div>
              </div>

              <div className={`${subPanelClass} p-5 sm:p-6`}>
                <div className={`mb-4 text-[11px] uppercase tracking-[0.24em] ${isLight ? "text-slate-500" : "text-slate-400"}`}>Nova Surface Notes</div>
                <div className="grid gap-3">
                  {accessCards.map((card) => {
                    const Icon = card.icon
                    return (
                      <div key={card.title} className={`${isLight ? "border-[#d7dfeb] bg-[#f8fbff]" : "border-white/10 bg-black/18"} home-spotlight-card rounded-2xl border p-4`}>
                        <div className="flex items-start justify-between gap-3">
                          <div className="flex items-start gap-3">
                            <div className={`grid h-10 w-10 shrink-0 place-items-center rounded-2xl border ${isLight ? "border-[#d5deea] bg-white" : "border-white/12 bg-white/6"}`}>
                              <Icon className={`h-4 w-4 ${isLight ? "text-slate-700" : "text-slate-200"}`} />
                            </div>
                            <div>
                              <div className={`text-sm font-semibold ${isLight ? "text-slate-950" : "text-white"}`}>{card.title}</div>
                              <p className={`mt-1 text-sm leading-6 ${isLight ? "text-slate-600" : "text-slate-300"}`}>{card.body}</p>
                            </div>
                          </div>
                          <span className={`shrink-0 rounded-full border px-2.5 py-1 text-[10px] uppercase tracking-[0.18em] ${isLight ? "border-[#d4dbe7] bg-white text-slate-500" : "border-white/12 bg-white/6 text-slate-300"}`}>
                            {card.badge}
                          </span>
                        </div>
                      </div>
                    )
                  })}
                </div>
              </div>
            </div>

            <div className={`${subPanelClass} p-5 sm:p-6`}>
              <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                <div>
                  <div className={`text-[11px] uppercase tracking-[0.24em] ${isLight ? "text-slate-500" : "text-slate-400"}`}>Operator Guidance</div>
                  <div className={`mt-2 text-lg font-semibold ${isLight ? "text-slate-950" : "text-white"}`}>Clean onboarding without detached auth noise</div>
                </div>
                <div className={`max-w-xl text-sm leading-6 ${isLight ? "text-slate-600" : "text-slate-300"}`}>
                  New users enter through the same visual grammar as the rest of Nova: orb-tinted surfaces, focused support copy, and a direct handoff back into the shell instead of a generic SaaS auth slab.
                </div>
              </div>
            </div>
          </section>

          <section className="order-1 flex min-h-0 lg:order-2">
            <form onSubmit={onSubmit} autoComplete="off" className={`${subPanelClass} flex w-full flex-col p-5 sm:p-6`}>
              <div className="flex flex-wrap items-start justify-between gap-4">
                <div className="max-w-md">
                  <div className={`text-[11px] uppercase tracking-[0.24em] ${isLight ? "text-slate-500" : "text-slate-400"}`}>Identity Console</div>
                  <h2 className={`mt-2 text-2xl font-semibold tracking-[-0.03em] ${isLight ? "text-slate-950" : "text-white"}`}>{cardTitle}</h2>
                  <p className={`mt-2 text-sm leading-6 ${isLight ? "text-slate-600" : "text-slate-300"}`}>{cardSubtitle}</p>
                </div>
                <div className={`rounded-2xl border px-3 py-2 text-right ${isLight ? "border-[#d5deea] bg-white/90 text-slate-600" : "border-white/12 bg-white/6 text-slate-300"}`}>
                  <div className="text-[10px] uppercase tracking-[0.22em]">Route target</div>
                  <div className={`mt-1 text-sm font-medium ${isLight ? "text-slate-900" : "text-slate-100"}`}>{routeTarget}</div>
                </div>
              </div>

              <div className={`${isLight ? "border-[#d8dfeb] bg-[#f8fbff]" : "border-white/10 bg-black/20"} mt-5 rounded-[24px] border p-3`}>
                <div className={`mb-3 flex items-center justify-between text-[11px] uppercase tracking-[0.22em] ${isLight ? "text-slate-500" : "text-slate-400"}`}>
                  <span>Session lane</span>
                  <span>{modeTag}</span>
                </div>
                <div className={`grid grid-cols-2 gap-2 rounded-[20px] border p-1 ${isLight ? "border-[#d9e0ea] bg-white/90" : "border-white/10 bg-white/4"}`}>
                  <button type="button" onClick={() => switchMode("signin")} className={`px-4 py-3 text-sm font-medium transition-colors ${tabButtonClass(mode === "signin")}`}>
                    Sign In
                  </button>
                  <button type="button" onClick={() => switchMode("signup")} className={`px-4 py-3 text-sm font-medium transition-colors ${tabButtonClass(mode === "signup")}`}>
                    Create Account
                  </button>
                </div>
                {(mode === "forgot" || mode === "reset") && (
                  <div className={`mt-3 rounded-2xl border px-4 py-3 text-sm leading-6 ${isLight ? "border-[#d8dfeb] bg-white text-slate-600" : "border-white/10 bg-black/16 text-slate-300"}`}>
                    Recovery mode keeps the same shell route and only swaps the credential workflow.
                  </div>
                )}
              </div>

              <div className="mt-5 space-y-4">
                {mode === "signup" && (
                  <label className="block">
                    <span className={`mb-2 block text-sm ${isLight ? "text-slate-600" : "text-slate-300"}`}>Profile name</span>
                    <div className={inputShellClass}>
                      <input
                        name="name"
                        type="text"
                        value={name}
                        onChange={(event) => {
                          if (debugEnabled) loginDebugEvent("login-page", "input:name", `len=${event.target.value.length}`)
                          setName(event.target.value)
                        }}
                        placeholder="How Nova should identify you"
                        autoComplete="name"
                        className={`h-14 w-full rounded-2xl bg-transparent px-4 text-base outline-none ${isLight ? "text-slate-950 placeholder:text-slate-400" : "text-white placeholder:text-slate-500"}`}
                      />
                    </div>
                  </label>
                )}

                {mode !== "reset" && (
                  <label className="block">
                    <span className={`mb-2 block text-sm ${isLight ? "text-slate-600" : "text-slate-300"}`}>Email</span>
                    <div className={inputShellClass}>
                      <input
                        name="email"
                        type="email"
                        value={email}
                        onChange={(event) => {
                          if (debugEnabled) loginDebugEvent("login-page", "input:email", `len=${event.target.value.length}`)
                          setEmail(event.target.value)
                        }}
                        placeholder="you@example.com"
                        autoComplete={mode === "signup" ? "email" : "username"}
                        autoFocus
                        className={`h-14 w-full rounded-2xl bg-transparent px-4 text-base outline-none ${isLight ? "text-slate-950 placeholder:text-slate-400" : "text-white placeholder:text-slate-500"}`}
                      />
                    </div>
                  </label>
                )}

                {mode !== "forgot" && (
                  <label className="block">
                    <span className={`mb-2 block text-sm ${isLight ? "text-slate-600" : "text-slate-300"}`}>{mode === "reset" ? "New password" : "Password"}</span>
                    <div className={`${passwordShellClass} relative`}>
                      <input
                        name="password"
                        type={showPassword ? "text" : "password"}
                        value={password}
                        onChange={(event) => {
                          if (debugEnabled) loginDebugEvent("login-page", "input:password", `len=${event.target.value.length}`)
                          setPassword(event.target.value)
                        }}
                        placeholder={mode === "reset" ? "Set a new password" : "Enter your password"}
                        autoComplete={mode === "signup" || mode === "reset" ? "new-password" : "current-password"}
                        className={`h-14 w-full rounded-2xl bg-transparent px-4 pr-14 text-base outline-none ${isLight ? "text-slate-950 placeholder:text-slate-400" : "text-white placeholder:text-slate-500"}`}
                      />
                      <button
                        type="button"
                        aria-label={showPassword ? "Hide password" : "Show password"}
                        onClick={() => setShowPassword((value) => !value)}
                        className={`absolute right-3 top-1/2 -translate-y-1/2 rounded-xl p-2 transition-colors ${isLight ? "text-slate-500 hover:text-slate-900" : "text-slate-400 hover:text-white"}`}
                      >
                        {showPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                      </button>
                    </div>
                  </label>
                )}

                {mode === "signup" && (
                  <label className="block">
                    <span className={`mb-2 block text-sm ${isLight ? "text-slate-600" : "text-slate-300"}`}>Confirm password</span>
                    <div className={`${passwordShellClass} relative`}>
                      <input
                        name="confirmPassword"
                        type={showConfirmPassword ? "text" : "password"}
                        value={confirmPassword}
                        onChange={(event) => {
                          if (debugEnabled) loginDebugEvent("login-page", "input:confirm", `len=${event.target.value.length}`)
                          setConfirmPassword(event.target.value)
                        }}
                        placeholder="Repeat your password"
                        autoComplete="new-password"
                        className={`h-14 w-full rounded-2xl bg-transparent px-4 pr-14 text-base outline-none ${isLight ? "text-slate-950 placeholder:text-slate-400" : "text-white placeholder:text-slate-500"}`}
                      />
                      <button
                        type="button"
                        aria-label={showConfirmPassword ? "Hide confirm password" : "Show confirm password"}
                        onClick={() => setShowConfirmPassword((value) => !value)}
                        className={`absolute right-3 top-1/2 -translate-y-1/2 rounded-xl p-2 transition-colors ${isLight ? "text-slate-500 hover:text-slate-900" : "text-slate-400 hover:text-white"}`}
                      >
                        {showConfirmPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                      </button>
                    </div>
                  </label>
                )}
              </div>

              {(error || notice) && (
                <div className={`${isLight ? "border-[#d8dfeb] bg-white/88" : "border-white/10 bg-black/18"} mt-4 rounded-2xl border p-4`}>
                  {error ? <p className={`text-sm leading-6 ${isLight ? "text-rose-600" : "text-rose-200"}`}>{error}</p> : null}
                  {notice ? <p className={`text-sm leading-6 ${isLight ? "text-emerald-600" : "text-emerald-100"}`}>{notice}</p> : null}
                </div>
              )}

              <div className="mt-5 grid gap-3">
                <button
                  type="submit"
                  disabled={submitDisabled}
                  className={`${primaryActionClass} h-14 px-4 text-sm font-semibold transition-colors ${submitDisabled ? "cursor-not-allowed opacity-45" : "home-spotlight-card--hover"}`}
                >
                  {busy
                    ? "Please wait..."
                    : mode === "signup"
                      ? "Create Account"
                      : mode === "forgot"
                        ? "Send Reset Link"
                        : mode === "reset"
                          ? "Update Password"
                          : "Sign In"}
                </button>

                {mode === "signin" && (
                  <button type="button" onClick={() => switchMode("forgot")} className={`${secondaryActionClass} h-12 px-4 text-sm font-medium transition-colors home-spotlight-card--hover`}>
                    Forgot Password
                  </button>
                )}
              </div>

              {(mode === "signin" || mode === "signup") && (
                <>
                  <div className="my-5 flex items-center gap-3">
                    <div className={`h-px flex-1 ${isLight ? "bg-slate-300" : "bg-white/16"}`} />
                    <span className={`text-[11px] font-medium uppercase tracking-[0.22em] ${isLight ? "text-slate-400" : "text-slate-500"}`}>Or continue through</span>
                    <div className={`h-px flex-1 ${isLight ? "bg-slate-300" : "bg-white/16"}`} />
                  </div>

                  <button
                    type="button"
                    onClick={() => void onGoogleAuth()}
                    disabled={busy}
                    className={`${secondaryActionClass} home-spotlight-card--hover flex h-14 items-center justify-center gap-3 px-4 text-sm font-medium transition-colors disabled:cursor-not-allowed disabled:opacity-55`}
                  >
                    <Image src="/images/google.svg" alt="" width={20} height={20} className="h-5 w-5" />
                    Continue with Google
                  </button>
                </>
              )}

              <div className={`${isLight ? "border-[#d8dfeb] bg-[#f8fbff]" : "border-white/10 bg-black/18"} mt-5 rounded-[24px] border p-4`}>
                <div className={`text-[11px] uppercase tracking-[0.22em] ${isLight ? "text-slate-500" : "text-slate-400"}`}>Support</div>
                <p className={`mt-2 text-sm leading-6 ${isLight ? "text-slate-600" : "text-slate-300"}`}>
                  {mode === "signin"
                    ? "Need a fresh workspace instead of an existing session?"
                    : mode === "signup"
                      ? "Already have a Nova identity provisioned?"
                      : "Return to the standard login flow once recovery is complete."}
                </p>
                <div className="mt-4 grid gap-3 sm:grid-cols-2">
                  <button
                    type="button"
                    className={`${switchActionClass} home-spotlight-card--hover h-12 px-4 text-sm font-medium transition-colors`}
                    onClick={() => {
                      if (mode === "signin") switchMode("signup")
                      else if (mode === "signup") switchMode("signin")
                      else switchMode("signin")
                    }}
                  >
                    {mode === "signin" ? "Create account" : mode === "signup" ? "Sign in instead" : "Back to sign in"}
                  </button>
                  {(mode === "signin" || mode === "signup") && (
                    <button
                      type="button"
                      onClick={() => void onGoogleAuth()}
                      disabled={busy}
                      className={`${switchActionClass} home-spotlight-card--hover h-12 px-4 text-sm font-medium transition-colors disabled:cursor-not-allowed disabled:opacity-55`}
                    >
                      Google session
                    </button>
                  )}
                </div>
              </div>
            </form>
          </section>
        </div>
      </div>

      {debugEnabled && (
        <div className="fixed bottom-2 right-2 z-50 max-h-[48vh] w-[26rem] overflow-auto rounded-md border border-white/20 bg-black/75 p-2 text-[11px] text-white/90">
          <div className="mb-1 font-mono text-white/95">Login Debug id={debugMountIdRef.current}</div>
          <pre className="wrap-break-word whitespace-pre-wrap font-mono">
            {JSON.stringify(
              {
                counters: debugPanel.counters,
                events: debugPanel.events.slice(-16),
              },
              null,
              2,
            )}
          </pre>
        </div>
      )}
    </main>
  )
}
