"use client"

import { useCallback, useEffect, useMemo, useState } from "react"
import { Button } from "@/components/ui/button"
import { cn } from "@/lib/shared/utils"

type SkillSummary = {
  name: string
  description: string
  updatedAt: string
  chars: number
}

type SkillsListResponse = {
  ok?: boolean
  error?: string
  skills?: SkillSummary[]
}

type SkillDetailResponse = {
  ok?: boolean
  error?: string
  name?: string
  content?: string
}

type SkillMutationResponse = {
  ok?: boolean
  error?: string
  errors?: string[]
  name?: string
  content?: string
  deleted?: string
  installed?: string[]
  skills?: SkillSummary[]
}

interface SettingsSkillsPanelProps {
  isLight: boolean
}

function getCardClass(isLight: boolean): string {
  return cn(
    "fx-spotlight-card fx-border-glow rounded-xl border transition-all duration-150",
    isLight
      ? "border-[#d5dce8] bg-[#f4f7fd] hover:bg-[#eef3fb]"
      : "border-white/10 bg-black/20 hover:bg-white/[0.06]",
  )
}

function getFieldClass(isLight: boolean): string {
  return cn(
    "w-full rounded-lg border px-3 py-2.5 text-sm outline-none transition-colors duration-150 focus:border-accent-50",
    isLight
      ? "border-[#d5dce8] bg-white text-s-90 placeholder:text-s-25 focus:bg-[#eef3fb]"
      : "border-white/10 bg-black/25 text-slate-100 placeholder:text-slate-500 focus:bg-white/[0.06]",
  )
}

export function SettingsSkillsPanel({ isLight }: SettingsSkillsPanelProps) {
  const [skills, setSkills] = useState<SkillSummary[]>([])
  const [selectedSkillName, setSelectedSkillName] = useState("")
  const [skillContent, setSkillContent] = useState("")
  const [newSkillName, setNewSkillName] = useState("")
  const [newSkillDescription, setNewSkillDescription] = useState("")
  const [listLoading, setListLoading] = useState(false)
  const [saving, setSaving] = useState(false)
  const [creating, setCreating] = useState(false)
  const [installing, setInstalling] = useState(false)
  const [deleting, setDeleting] = useState(false)
  const [dirty, setDirty] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [status, setStatus] = useState("")
  const [validationErrors, setValidationErrors] = useState<string[]>([])
  const [deleteConfirmOpen, setDeleteConfirmOpen] = useState(false)
  const [createModalOpen, setCreateModalOpen] = useState(false)
  const spotlightCardClass = "fx-spotlight-card fx-border-glow"

  const fetchSkillList = useCallback(async (preferredSkillName?: string) => {
    setListLoading(true)
    setError(null)
    try {
      const res = await fetch("/api/workspace/skills", { cache: "no-store" })
      const data = (await res.json().catch(() => ({}))) as SkillsListResponse
      if (!res.ok || !data.ok) {
        throw new Error(data.error || "Failed to load skills.")
      }
      const nextSkills = Array.isArray(data.skills) ? data.skills : []
      setSkills(nextSkills)

      const target =
        preferredSkillName && nextSkills.some((skill) => skill.name === preferredSkillName)
          ? preferredSkillName
          : nextSkills[0]?.name || ""
      if (!target) {
        setSelectedSkillName("")
        setSkillContent("")
        setDirty(false)
        return
      }
      setSelectedSkillName((prev) => {
        if (preferredSkillName && prev !== preferredSkillName) return preferredSkillName
        if (prev && nextSkills.some((skill) => skill.name === prev)) return prev
        return target
      })
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : "Failed to load skills.")
    } finally {
      setListLoading(false)
    }
  }, [])

  const loadSkill = useCallback(async (name: string) => {
    if (!name) return
    setError(null)
    setValidationErrors([])
    try {
      const res = await fetch(`/api/workspace/skills?name=${encodeURIComponent(name)}`, { cache: "no-store" })
      const data = (await res.json().catch(() => ({}))) as SkillDetailResponse
      if (!res.ok || !data.ok) {
        throw new Error(data.error || "Failed to load skill.")
      }
      setSelectedSkillName(name)
      setSkillContent(String(data.content || ""))
      setDirty(false)
      setStatus("")
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : "Failed to load skill.")
    }
  }, [])

  useEffect(() => {
    void fetchSkillList()
  }, [fetchSkillList])

  useEffect(() => {
    if (!selectedSkillName) return
    void loadSkill(selectedSkillName)
  }, [loadSkill, selectedSkillName])

  const selectSkill = useCallback((name: string) => {
    if (!name || name === selectedSkillName) return
    if (dirty && typeof window !== "undefined") {
      const confirmed = window.confirm("Discard unsaved changes for this skill?")
      if (!confirmed) return
    }
    setSelectedSkillName(name)
  }, [dirty, selectedSkillName])

  const createSkill = useCallback(async () => {
    const trimmedName = newSkillName.trim()
    if (!trimmedName) {
      setError("Enter a skill name first.")
      return
    }
    setCreating(true)
    setError(null)
    setValidationErrors([])
    try {
      const res = await fetch("/api/workspace/skills", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: trimmedName,
          description: newSkillDescription.trim(),
        }),
      })
      const data = (await res.json().catch(() => ({}))) as SkillMutationResponse
      if (!res.ok || !data.ok) {
        const detail = Array.isArray(data.errors) && data.errors.length > 0
          ? `${data.error || "Failed to create skill."} ${data.errors.join(" ")}`
          : data.error || "Failed to create skill."
        throw new Error(detail)
      }
      const createdName = String(data.name || "").trim()
      setNewSkillName("")
      setNewSkillDescription("")
      setCreateModalOpen(false)
      setStatus(`Created skill: ${createdName}`)
      await fetchSkillList(createdName)
      if (createdName) {
        setSelectedSkillName(createdName)
        setSkillContent(String(data.content || ""))
        setDirty(false)
      }
    } catch (createError) {
      setError(createError instanceof Error ? createError.message : "Failed to create skill.")
    } finally {
      setCreating(false)
    }
  }, [fetchSkillList, newSkillDescription, newSkillName])

  const installStarterTemplates = useCallback(async () => {
    setInstalling(true)
    setError(null)
    setValidationErrors([])
    try {
      const res = await fetch("/api/workspace/skills", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "install-starters" }),
      })
      const data = (await res.json().catch(() => ({}))) as SkillMutationResponse
      if (!res.ok || !data.ok) {
        throw new Error(data.error || "Failed to install starter templates.")
      }
      const installed = Array.isArray(data.installed) ? data.installed : []
      if (installed.length > 0) {
        setStatus(`Installed starter templates: ${installed.join(", ")}`)
      } else {
        setStatus("Starter templates already installed.")
      }
      const preferred = installed[0] || selectedSkillName
      await fetchSkillList(preferred)
    } catch (installError) {
      setError(installError instanceof Error ? installError.message : "Failed to install starter templates.")
    } finally {
      setInstalling(false)
    }
  }, [fetchSkillList, selectedSkillName])

  const saveSkill = useCallback(async () => {
    if (!selectedSkillName) {
      setError("Select or create a skill before saving.")
      return
    }
    setSaving(true)
    setError(null)
    setValidationErrors([])
    try {
      const res = await fetch("/api/workspace/skills", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: selectedSkillName,
          content: skillContent,
        }),
      })
      const data = (await res.json().catch(() => ({}))) as SkillMutationResponse
      if (!res.ok || !data.ok) {
        if (Array.isArray(data.errors) && data.errors.length > 0) {
          setValidationErrors(data.errors.map((item) => String(item)))
        }
        throw new Error(data.error || "Failed to save skill.")
      }
      setDirty(false)
      setStatus(`Saved ${selectedSkillName}`)
      await fetchSkillList(selectedSkillName)
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : "Failed to save skill.")
    } finally {
      setSaving(false)
    }
  }, [fetchSkillList, selectedSkillName, skillContent])

  const deleteSkill = useCallback(async () => {
    if (!selectedSkillName) return
    setDeleting(true)
    setError(null)
    setValidationErrors([])
    try {
      const res = await fetch(`/api/workspace/skills?name=${encodeURIComponent(selectedSkillName)}`, {
        method: "DELETE",
      })
      const data = (await res.json().catch(() => ({}))) as SkillMutationResponse
      if (!res.ok || !data.ok) {
        throw new Error(data.error || "Failed to delete skill.")
      }
      setStatus(`Deleted ${selectedSkillName}`)
      setSkillContent("")
      setDirty(false)
      await fetchSkillList()
    } catch (deleteError) {
      setError(deleteError instanceof Error ? deleteError.message : "Failed to delete skill.")
    } finally {
      setDeleting(false)
    }
  }, [fetchSkillList, selectedSkillName])

  const selectedSkillSummary = useMemo(
    () => skills.find((skill) => skill.name === selectedSkillName) ?? null,
    [selectedSkillName, skills],
  )

  return (
    <div className="h-full min-h-0 flex flex-col gap-4">
      <div className="grid min-h-0 flex-1 items-stretch gap-4 lg:grid-cols-[260px_minmax(0,1fr)]">
        <div className={cn(getCardClass(isLight), "p-3 min-h-0 h-full flex flex-col")}>
          <div className="mb-2 flex items-center justify-between gap-2">
            <p className={cn("text-xs uppercase tracking-wide", isLight ? "text-s-40" : "text-slate-400")}>
              Your Skills
            </p>
            <Button
              variant="outline"
              size="sm"
              onClick={() => {
                setError(null)
                setValidationErrors([])
                setStatus("")
                setCreateModalOpen(true)
              }}
              disabled={creating}
              className={cn(
                `${spotlightCardClass} h-9`,
                isLight
                  ? "text-s-50 border-[#d5dce8] hover:border-accent-30 hover:text-accent hover:bg-accent-10"
                  : "text-slate-300 border-white/15 hover:border-accent-30 hover:text-accent hover:bg-accent-10",
              )}
            >
              New Skill
            </Button>
          </div>
          <div className="space-y-1.5 min-h-0 flex-1 overflow-y-auto pr-1">
            {skills.length === 0 ? (
              <p className={cn("px-1 text-xs", isLight ? "text-s-35" : "text-slate-500")}>
                No skills yet. Use New Skill.
              </p>
            ) : (
              skills.map((skill) => {
                const isSelected = skill.name === selectedSkillName
                return (
                  <button
                    key={skill.name}
                    onClick={() => selectSkill(skill.name)}
                    className={cn(
                      "w-full rounded-lg border px-2.5 py-2 text-left transition-colors duration-150",
                      isSelected
                        ? isLight
                          ? "border-accent-30 bg-[#edf3ff]"
                          : "border-accent-30 bg-white/8"
                        : isLight
                          ? "border-transparent bg-white hover:border-[#d5dce8] hover:bg-[#eef3fb]"
                          : "border-transparent bg-black/20 hover:border-white/10 hover:bg-white/[0.06]",
                    )}
                  >
                    <p className={cn("truncate text-sm", isLight ? "text-s-70" : "text-slate-200")}>{skill.name}</p>
                    <p className={cn("line-clamp-2 text-xs mt-0.5", isLight ? "text-s-35" : "text-slate-500")}>
                      {skill.description}
                    </p>
                  </button>
                )
              })
            )}
          </div>
        </div>

        <div className={cn(getCardClass(isLight), "p-4 min-h-0 h-full flex flex-col")}>
          <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
            <div>
              <p className={cn("text-sm", isLight ? "text-s-70" : "text-slate-200")}>
                {selectedSkillName || "Select a skill"}
              </p>
              {selectedSkillSummary ? (
                <p className={cn("text-xs", isLight ? "text-s-35" : "text-slate-500")}>
                  {selectedSkillSummary.description}
                </p>
              ) : null}
            </div>
            <div className="flex items-center gap-2">
              <Button
                onClick={() => void saveSkill()}
                disabled={saving || !dirty || !selectedSkillName}
                size="sm"
                className={cn(
                  "fx-spotlight-card fx-border-glow h-9 w-24 border text-white disabled:opacity-60",
                  isLight
                    ? "bg-emerald-600 border-emerald-700 hover:bg-emerald-700"
                    : "bg-emerald-500/80 border-emerald-300/60 hover:bg-emerald-500",
                )}
              >
                {saving ? "Saving..." : "Save"}
              </Button>
              <Button
                onClick={() => setDeleteConfirmOpen(true)}
                disabled={deleting || !selectedSkillName}
                size="sm"
                className={cn(
                  "fx-spotlight-card fx-border-glow h-9 w-24 border disabled:opacity-60",
                  isLight
                    ? "bg-rose-50 border-rose-200 text-rose-700 hover:bg-rose-100"
                    : "bg-rose-500/10 border-rose-400/40 text-rose-200 hover:bg-rose-500/20",
                )}
              >
                {deleting ? "Deleting..." : "Delete"}
              </Button>
            </div>
          </div>

          <textarea
            value={skillContent}
            onChange={(e) => {
              setSkillContent(e.target.value)
              setDirty(true)
              setStatus("")
            }}
            spellCheck={false}
            autoCorrect="off"
            autoCapitalize="off"
            data-gramm="false"
            data-gramm_editor="false"
            data-enable-grammarly="false"
            disabled={!selectedSkillName}
            className={cn(getFieldClass(isLight), "mt-1 min-h-0 flex-1 resize-none font-mono text-xs leading-5")}
            placeholder="Create or select a skill to edit SKILL.md"
          />

          <div className="mt-2 flex flex-wrap items-center justify-between gap-2">
            <p className={cn("text-xs", isLight ? "text-s-35" : "text-slate-500")}>
              {skillContent.length} chars
            </p>
            {error ? (
              <p className="text-xs text-rose-400">{error}</p>
            ) : validationErrors.length > 0 ? (
              <p className="text-xs text-amber-400">Validation failed</p>
            ) : dirty ? (
              <p className={cn("text-xs", isLight ? "text-amber-700" : "text-amber-300")}>Unsaved changes</p>
            ) : status ? (
              <p className={cn("text-xs", isLight ? "text-emerald-700" : "text-emerald-300")}>{status}</p>
            ) : null}
          </div>

          {validationErrors.length > 0 ? (
            <div className={cn("mt-2 rounded-lg border p-2 text-xs", isLight ? "border-amber-300 bg-amber-50 text-amber-900" : "border-amber-400/40 bg-amber-500/10 text-amber-200")}>
              {validationErrors.map((item) => (
                <p key={item}>- {item}</p>
              ))}
            </div>
          ) : null}
        </div>
      </div>

      {createModalOpen ? (
        <div className="fixed inset-0 z-[70] flex items-center justify-center bg-black/55 backdrop-blur-sm">
          <div
            className={cn(
              "home-spotlight-shell w-[640px] max-w-[94vw] rounded-2xl border p-4",
              isLight
                ? "border-[#d5dce8] bg-white/95"
                : "border-white/15 bg-[#0c1320]/88 backdrop-blur-xl",
            )}
          >
            <div className="mb-3 flex items-center justify-between gap-2">
              <h4 className={cn("text-sm font-medium", isLight ? "text-s-70" : "text-slate-100")}>New Skill</h4>
              <Button
                variant="ghost"
                size="sm"
                onClick={() => setCreateModalOpen(false)}
                disabled={creating}
                className={cn(
                  `${spotlightCardClass} h-8 px-3`,
                  isLight ? "text-s-60 hover:bg-[#eef3fb]" : "text-slate-300 hover:bg-white/[0.06]",
                )}
              >
                Close
              </Button>
            </div>
            <div className="space-y-2.5">
              <input
                value={newSkillName}
                onChange={(e) => setNewSkillName(e.target.value)}
                className={cn(getFieldClass(isLight), "h-10")}
                placeholder="skill-name (lowercase-hyphen)"
              />
              <input
                value={newSkillDescription}
                onChange={(e) => setNewSkillDescription(e.target.value)}
                className={cn(getFieldClass(isLight), "h-10")}
                placeholder="When this skill should trigger"
              />
            </div>
            <div className="mt-3 flex items-center justify-end gap-2">
              <Button
                variant="ghost"
                size="sm"
                onClick={() => setCreateModalOpen(false)}
                disabled={creating}
                className={cn(isLight ? "text-s-60 hover:bg-[#eef3fb]" : "text-slate-300 hover:bg-white/[0.06]")}
              >
                Cancel
              </Button>
              <Button
                onClick={() => void createSkill()}
                disabled={creating || installing}
                variant="outline"
                size="sm"
                className={cn(
                  `${spotlightCardClass} h-9`,
                  isLight
                    ? "text-s-50 border-[#d5dce8] hover:border-accent-30 hover:text-accent hover:bg-accent-10"
                    : "text-slate-300 border-white/15 hover:border-accent-30 hover:text-accent hover:bg-accent-10",
                )}
              >
                {creating ? "Creating..." : "Create Skill"}
              </Button>
            </div>
          </div>
        </div>
      ) : null}

      {deleteConfirmOpen && selectedSkillName ? (
        <div className="fixed inset-0 z-[70] flex items-center justify-center bg-black/55 backdrop-blur-sm">
          <div className={cn(
            "w-[420px] rounded-2xl border p-4",
            isLight
              ? "border-rose-200 bg-white/95"
              : "border-rose-400/35 bg-[#1a0f14]/90 backdrop-blur-xl",
          )}>
            <h4 className={cn("text-sm font-medium", isLight ? "text-rose-700" : "text-rose-200")}>
              Delete skill
            </h4>
            <p className={cn("mt-1 text-xs", isLight ? "text-rose-500" : "text-rose-300")}>
              This removes <code>{selectedSkillName}</code> from this user profile. This action cannot be undone.
            </p>
            <div className="mt-4 flex justify-end gap-2">
              <Button
                variant="ghost"
                size="sm"
                onClick={() => setDeleteConfirmOpen(false)}
                disabled={deleting}
                className={cn(isLight ? "text-s-50 hover:bg-[#eef3fb]" : "text-slate-300 hover:bg-white/[0.06]")}
              >
                Cancel
              </Button>
              <Button
                size="sm"
                onClick={async () => {
                  await deleteSkill()
                  setDeleteConfirmOpen(false)
                }}
                disabled={deleting}
                className={cn(
                  "border",
                  isLight
                    ? "bg-rose-600 hover:bg-rose-700 text-white border-rose-700"
                    : "bg-rose-500/20 hover:bg-rose-500/30 text-rose-100 border-rose-400/40",
                )}
              >
                {deleting ? "Deleting..." : "Delete Skill"}
              </Button>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  )
}
