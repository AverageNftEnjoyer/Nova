"use client"

import { Mail, ChevronRight, Shield, Trash2, User } from "lucide-react"
import { Button } from "@/components/ui/button"
import { cn } from "@/lib/shared/utils"
import { playClickSound } from "@/components/settings/settings-primitives"
import type { UserSettings } from "@/lib/settings/userSettings"

interface Props {
  isLight: boolean
  settings: UserSettings
  authConfigured: boolean
  authAuthenticated: boolean
  authEmail: string
  authBusy: boolean
  authError: string
  accountBusy: boolean
  accountMessage: string
  emailModalOpen: boolean
  deleteModalOpen: boolean
  pendingEmail: string
  deletePassword: string
  setPendingEmail: (v: string) => void
  setDeletePassword: (v: string) => void
  setEmailModalOpen: (v: boolean) => void
  setDeleteModalOpen: (v: boolean) => void
  navigateToLogin: () => void
  handleSignOut: () => Promise<void>
  handleSendPasswordReset: () => Promise<void>
  handleRequestEmailChange: () => Promise<void>
  handleDeleteAccount: () => Promise<void>
}

export function SettingsAccountPanel({
  isLight,
  settings,
  authConfigured,
  authAuthenticated,
  authEmail,
  authBusy,
  authError,
  accountBusy,
  accountMessage,
  emailModalOpen,
  deleteModalOpen,
  pendingEmail,
  deletePassword,
  setPendingEmail,
  setDeletePassword,
  setEmailModalOpen,
  setDeleteModalOpen,
  navigateToLogin,
  handleSignOut,
  handleSendPasswordReset,
  handleRequestEmailChange,
  handleDeleteAccount,
}: Props) {
  return (
    <div className="space-y-5">
      {/* Session */}
      <div className={cn(
        "fx-spotlight-card fx-border-glow p-4 rounded-xl border transition-colors duration-150",
        isLight ? "border-[#d5dce8] bg-[#f4f7fd] hover:bg-[#eef3fb]" : "border-white/10 bg-black/20 hover:bg-white/6"
      )}>
        <p className={cn("text-sm mb-2", isLight ? "text-s-70" : "text-slate-200")}>Session</p>
        <p className={cn("text-xs", isLight ? "text-s-40" : "text-slate-500")}>
          {authConfigured ? (authAuthenticated ? "Signed in" : "Signed out") : "Auth not configured yet"}
        </p>
        <div className="mt-3 flex gap-2">
          {!authAuthenticated ? (
            <Button
              onClick={() => { playClickSound(); navigateToLogin() }}
              disabled={authBusy}
              size="sm"
              className="fx-spotlight-card fx-border-glow"
            >
              Sign In
            </Button>
          ) : (
            <Button
              onClick={() => { playClickSound(); void handleSignOut() }}
              disabled={authBusy}
              variant="outline"
              size="sm"
              className="fx-spotlight-card fx-border-glow text-rose-300 border-rose-400/30 hover:bg-rose-500/10"
            >
              {authBusy ? "Signing out..." : "Sign Out"}
            </Button>
          )}
        </div>
        {authError && (
          <p className={cn("mt-2 text-xs", authError.startsWith("Reset link sent") ? "text-emerald-300" : "text-rose-300")}>
            {authError}
          </p>
        )}
      </div>

      {/* Account info */}
      <div className={cn(
        "fx-spotlight-card fx-border-glow p-4 rounded-xl border transition-colors duration-150",
        isLight ? "border-[#d5dce8] bg-[#f4f7fd] hover:bg-[#eef3fb]" : "border-white/10 bg-black/20 hover:bg-white/6"
      )}>
        <div className="flex items-center gap-3 mb-4">
          <div className={cn(
            "w-10 h-10 rounded-xl flex items-center justify-center",
            isLight ? "bg-accent-15 border border-accent-20" : "bg-accent-20 border border-accent-30"
          )}>
            <Shield className="w-5 h-5 text-accent" />
          </div>
          <div>
            <p className={cn("text-sm", isLight ? "text-s-70" : "text-slate-300")}>Account</p>
            <p className={cn("text-xs", isLight ? "text-s-40" : "text-slate-500")}>{authEmail || "No account email found"}</p>
          </div>
        </div>

        <div className="space-y-2 mb-3">
          <div className={cn(
            "flex items-center justify-between rounded-xl border px-3 py-2.5",
            isLight ? "border-[#d5dce8] bg-white" : "border-white/10 bg-black/25"
          )}>
            <div className="min-w-0">
              <p className={cn("text-[11px] uppercase tracking-wide", isLight ? "text-s-40" : "text-slate-500")}>Name</p>
              <p className={cn("truncate text-sm", isLight ? "text-s-70" : "text-slate-200")}>{settings.profile.name || "User"}</p>
            </div>
            <User className={cn("w-4 h-4 shrink-0", isLight ? "text-s-40" : "text-slate-500")} />
          </div>
          <button
            onClick={() => { playClickSound(); setPendingEmail(authEmail); setEmailModalOpen(true) }}
            disabled={!authAuthenticated}
            className={cn(
              "w-full flex items-center justify-between rounded-xl border px-3 py-2.5 transition-colors duration-150 disabled:opacity-60",
              isLight ? "border-[#d5dce8] bg-white hover:bg-[#eef3fb]" : "border-white/10 bg-black/25 hover:bg-white/6"
            )}
          >
            <div className="min-w-0 text-left">
              <p className={cn("text-[11px] uppercase tracking-wide", isLight ? "text-s-40" : "text-slate-500")}>Email</p>
              <p className={cn("truncate text-sm", isLight ? "text-s-70" : "text-slate-200")}>{authEmail || "No account email found"}</p>
            </div>
            <div className="flex items-center gap-1.5 shrink-0">
              <Mail className={cn("w-4 h-4", isLight ? "text-s-40" : "text-slate-400")} />
              <ChevronRight className={cn("w-4 h-4", isLight ? "text-s-40" : "text-slate-400")} />
            </div>
          </button>
        </div>

        <div className="grid grid-cols-1 gap-2">
          <button
            onClick={() => { playClickSound(); void handleSendPasswordReset() }}
            disabled={authBusy || !authAuthenticated}
            className={cn(
              "w-full flex items-center justify-center px-4 py-3 rounded-xl transition-colors duration-150 fx-spotlight-card fx-border-glow border text-sm disabled:opacity-60",
              isLight ? "bg-white border-[#d5dce8] hover:bg-[#eef3fb] text-s-60" : "bg-black/25 border-white/10 hover:bg-white/6 text-slate-200"
            )}
          >
            Send Password Reset Link
          </button>
          <button
            onClick={() => { playClickSound(); setDeletePassword(""); setDeleteModalOpen(true) }}
            disabled={accountBusy || !authAuthenticated}
            className={cn(
              "w-full flex items-center justify-center gap-2 px-4 py-3 rounded-xl transition-colors duration-150 fx-spotlight-card fx-border-glow border text-sm disabled:opacity-60",
              isLight ? "bg-rose-50 border-rose-200 hover:bg-rose-100 text-rose-700" : "bg-rose-500/10 border-rose-400/30 hover:bg-rose-500/15 text-rose-300"
            )}
          >
            <Trash2 className="w-4 h-4" />
            Permanently Delete Account
          </button>
          {!authAuthenticated && (
            <button
              onClick={() => { playClickSound(); navigateToLogin() }}
              disabled={authBusy}
              className={cn(
                "w-full flex items-center justify-center px-4 py-3 rounded-xl transition-colors duration-150 fx-spotlight-card fx-border-glow border text-sm disabled:opacity-60",
                isLight ? "bg-white border-[#d5dce8] hover:bg-[#eef3fb] text-s-60" : "bg-black/25 border-white/10 hover:bg-white/6 text-slate-200"
              )}
            >
              Open Sign In
            </button>
          )}
        </div>
        {accountMessage && (
          <p className={cn("mt-2 text-xs", accountMessage.includes("failed") || accountMessage.includes("required") ? "text-rose-300" : "text-emerald-300")}>
            {accountMessage}
          </p>
        )}
      </div>

      {/* Email change modal */}
      {emailModalOpen && (
        <div className="fixed inset-0 z-60 flex items-center justify-center bg-black/55 backdrop-blur-sm">
          <div className={cn(
            "w-100 rounded-2xl border p-4",
            isLight ? "border-[#d9e0ea] bg-white/95" : "border-white/20 bg-white/6 backdrop-blur-xl"
          )}>
            <h4 className={cn("text-sm font-medium", isLight ? "text-s-90" : "text-white")}>Change account email</h4>
            <p className={cn("mt-1 text-xs", isLight ? "text-s-40" : "text-slate-400")}>
              A confirmation flow will be sent before the new email becomes active.
            </p>
            <label className="mt-4 block">
              <span className={cn("mb-1.5 block text-xs", isLight ? "text-s-40" : "text-slate-400")}>New email</span>
              <input
                type="email"
                value={pendingEmail}
                onChange={(e) => setPendingEmail(e.target.value)}
                className={cn(
                  "h-10 w-full rounded-lg border px-3 text-sm outline-none",
                  isLight ? "border-[#d5dce8] bg-white text-s-70" : "border-white/12 bg-black/25 text-slate-100"
                )}
              />
            </label>
            <div className="mt-4 flex justify-end gap-2">
              <Button
                variant="ghost"
                size="sm"
                onClick={() => setEmailModalOpen(false)}
                className={cn(isLight ? "text-s-50 hover:bg-[#eef3fb]" : "text-slate-300 hover:bg-white/6")}
              >
                Cancel
              </Button>
              <Button
                size="sm"
                onClick={() => void handleRequestEmailChange()}
                disabled={accountBusy || !pendingEmail.trim()}
                className="fx-spotlight-card fx-border-glow"
              >
                {accountBusy ? "Submitting..." : "Request Email Change"}
              </Button>
            </div>
          </div>
        </div>
      )}

      {/* Delete account modal */}
      {deleteModalOpen && (
        <div className="fixed inset-0 z-60 flex items-center justify-center bg-black/60 backdrop-blur-sm">
          <div className={cn(
            "w-105 rounded-2xl border p-4",
            isLight ? "border-rose-200 bg-white/95" : "border-rose-400/35 bg-[#1a0f14]/90 backdrop-blur-xl"
          )}>
            <h4 className={cn("text-sm font-medium", isLight ? "text-rose-700" : "text-rose-200")}>Permanent account deletion</h4>
            <p className={cn("mt-1 text-xs", isLight ? "text-rose-500" : "text-rose-300")}>
              This deletes your account and user data permanently. Enter your password to continue.
            </p>
            <label className="mt-4 block">
              <span className={cn("mb-1.5 block text-xs", isLight ? "text-rose-500" : "text-rose-300")}>Password confirmation (2FA)</span>
              <input
                type="password"
                value={deletePassword}
                onChange={(e) => setDeletePassword(e.target.value)}
                className={cn(
                  "h-10 w-full rounded-lg border px-3 text-sm outline-none",
                  isLight ? "border-rose-200 bg-white text-rose-700" : "border-rose-400/35 bg-black/25 text-rose-100"
                )}
              />
            </label>
            <div className="mt-4 flex justify-end gap-2">
              <Button
                variant="ghost"
                size="sm"
                onClick={() => setDeleteModalOpen(false)}
                className={cn(isLight ? "text-s-50 hover:bg-[#eef3fb]" : "text-slate-300 hover:bg-white/6")}
              >
                Cancel
              </Button>
              <Button
                size="sm"
                onClick={() => void handleDeleteAccount()}
                disabled={accountBusy || !deletePassword.trim()}
                className={cn(
                  "border",
                  isLight ? "bg-rose-600 hover:bg-rose-700 text-white border-rose-700" : "bg-rose-500/20 hover:bg-rose-500/30 text-rose-100 border-rose-400/40"
                )}
              >
                {accountBusy ? "Deleting..." : "Delete Account Permanently"}
              </Button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
