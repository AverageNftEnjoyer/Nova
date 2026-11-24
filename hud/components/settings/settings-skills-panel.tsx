"use client"

import { useCallback, useEffect, useState } from "react"
import { ArrowLeft, FileCode2, Plus } from "lucide-react"
import {
  Button,
  Dialog,
  DialogBody,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  EmptyState,
  Field,
  Input,
  Table,
  TBody,
  Td,
  Textarea,
  Th,
  THead,
  Tr,
  toast,
} from "@/components/ui"
import { SettingsGroup, SettingsLoadError, SettingsLoading } from "@/components/settings/settings-primitives"

interface SkillSummary {
  name: string
  description: string
  updatedAt: string
  chars: number
}

interface SkillsApiResponse {
  ok?: boolean
  error?: string
  errors?: string[]
  name?: string
  content?: string
  skills?: SkillSummary[]
  installed?: string[]
}

const SKILLS_URL = "/api/workspace/skills"

/** Where a skill lives inside the user's workspace folder (lib/workspace/skills/service resolveSkillFilePath). */
function skillPath(name: string): string {
  return `skills/${name}/SKILL.md`
}

function formatUpdated(iso: string): string {
  const date = new Date(iso)
  if (Number.isNaN(date.getTime())) return ""
  return date.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })
}

async function callSkillsApi(input: RequestInfo, init?: RequestInit): Promise<SkillsApiResponse> {
  const res = await fetch(input, { cache: "no-store", ...init })
  const data = (await res.json().catch(() => ({}))) as SkillsApiResponse
  if (!res.ok || !data.ok) {
    const error = new Error(data.error || "The skills request failed.") as Error & { details?: string[] }
    error.details = Array.isArray(data.errors) ? data.errors.map(String) : undefined
    throw error
  }
  return data
}

export function SettingsSkillsPanel() {
  const [skills, setSkills] = useState<SkillSummary[] | null>(null)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [installing, setInstalling] = useState(false)

  // Editor
  const [editing, setEditing] = useState<string | null>(null)
  const [content, setContent] = useState("")
  const [contentLoading, setContentLoading] = useState(false)
  const [dirty, setDirty] = useState(false)
  const [saving, setSaving] = useState(false)
  const [editorError, setEditorError] = useState<string | null>(null)
  const [validationErrors, setValidationErrors] = useState<string[]>([])

  // Dialogs
  const [createOpen, setCreateOpen] = useState(false)
  const [newName, setNewName] = useState("")
  const [newDescription, setNewDescription] = useState("")
  const [creating, setCreating] = useState(false)
  const [createError, setCreateError] = useState<string | null>(null)
  const [deleteOpen, setDeleteOpen] = useState(false)
  const [deleting, setDeleting] = useState(false)
  const [discardOpen, setDiscardOpen] = useState(false)

  const fetchSkills = useCallback(async () => {
    setLoadError(null)
    try {
      const data = await callSkillsApi(SKILLS_URL)
      setSkills(Array.isArray(data.skills) ? data.skills : [])
    } catch (reason) {
      setLoadError(reason instanceof Error ? reason.message : "The skills could not be read.")
    }
  }, [])

  useEffect(() => {
    void fetchSkills()
  }, [fetchSkills])

  const openSkill = useCallback(async (name: string) => {
    setEditing(name)
    setContent("")
    setDirty(false)
    setEditorError(null)
    setValidationErrors([])
    setContentLoading(true)
    try {
      const data = await callSkillsApi(`${SKILLS_URL}?name=${encodeURIComponent(name)}`)
      setContent(String(data.content || ""))
    } catch (reason) {
      setEditorError(reason instanceof Error ? reason.message : "This skill could not be read.")
    } finally {
      setContentLoading(false)
    }
  }, [])

  const closeEditor = () => {
    setEditing(null)
    setDirty(false)
    setDiscardOpen(false)
  }

  const requestCloseEditor = () => {
    if (dirty) setDiscardOpen(true)
    else closeEditor()
  }

  const installStarters = async () => {
    setInstalling(true)
    try {
      const data = await callSkillsApi(SKILLS_URL, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "install-starters" }),
      })
      setSkills(Array.isArray(data.skills) ? data.skills : [])
      const count = data.installed?.length ?? 0
      toast.success(count > 0 ? `Installed ${count} starter skill${count === 1 ? "" : "s"}` : "Starter skills are already installed")
    } catch (reason) {
      toast.error({ title: "Starter skills were not installed", description: reason instanceof Error ? reason.message : undefined })
    } finally {
      setInstalling(false)
    }
  }

  const createSkill = async () => {
    const name = newName.trim()
    if (!name) {
      setCreateError("Enter a name.")
      return
    }
    setCreating(true)
    setCreateError(null)
    try {
      const data = await callSkillsApi(SKILLS_URL, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name, description: newDescription.trim() }),
      })
      const created = String(data.name || name)
      setCreateOpen(false)
      setNewName("")
      setNewDescription("")
      toast.success(`Created ${created}`)
      await fetchSkills()
      setEditing(created)
      setContent(String(data.content || ""))
      setDirty(false)
      setEditorError(null)
      setValidationErrors([])
    } catch (reason) {
      const details = (reason as { details?: string[] }).details
      setCreateError(`${reason instanceof Error ? reason.message : "The skill was not created."}${details?.length ? ` ${details.join(" ")}` : ""}`)
    } finally {
      setCreating(false)
    }
  }

  const saveSkill = async () => {
    if (!editing) return
    setSaving(true)
    setEditorError(null)
    setValidationErrors([])
    try {
      await callSkillsApi(SKILLS_URL, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: editing, content }),
      })
      setDirty(false)
      toast.success(`Saved ${editing}`)
      void fetchSkills()
    } catch (reason) {
      setValidationErrors((reason as { details?: string[] }).details ?? [])
      setEditorError(reason instanceof Error ? reason.message : "The skill was not saved.")
    } finally {
      setSaving(false)
    }
  }

  const deleteSkill = async () => {
    if (!editing) return
    setDeleting(true)
    try {
      await callSkillsApi(`${SKILLS_URL}?name=${encodeURIComponent(editing)}`, { method: "DELETE" })
      toast.success(`Deleted ${editing}`)
      setDeleteOpen(false)
      closeEditor()
      await fetchSkills()
    } catch (reason) {
      toast.error({ title: "The skill was not deleted", description: reason instanceof Error ? reason.message : undefined })
    } finally {
      setDeleting(false)
    }
  }

  const dialogs = (
    <>
      <Dialog open={createOpen} onOpenChange={(open) => (creating ? undefined : setCreateOpen(open))} size="md" dismissible={!creating}>
        <DialogHeader>
          <DialogTitle>New skill</DialogTitle>
          <DialogDescription>Nova creates a SKILL.md template you can then edit.</DialogDescription>
        </DialogHeader>
        <DialogBody className="flex flex-col gap-4">
          <Field label="Name" hint="Lowercase letters, digits and hyphens, e.g. weekly-report." error={createError || undefined}>
            <Input
              value={newName}
              onChange={(e) => setNewName(e.target.value.toLowerCase())}
              onKeyDown={(e) => {
                if (e.key === "Enter") void createSkill()
              }}
              placeholder="weekly-report"
              mono
              data-autofocus
              autoComplete="off"
              spellCheck={false}
            />
          </Field>
          <Field label="When to use it" hint="One sentence. Agents load the skill when a request matches.">
            <Input
              value={newDescription}
              onChange={(e) => setNewDescription(e.target.value)}
              placeholder="When I ask for a summary of the week's work"
            />
          </Field>
        </DialogBody>
        <DialogFooter>
          <Button variant="ghost" size="sm" onClick={() => setCreateOpen(false)} disabled={creating}>
            Cancel
          </Button>
          <Button size="sm" onClick={() => void createSkill()} loading={creating}>
            Create skill
          </Button>
        </DialogFooter>
      </Dialog>

      <Dialog open={deleteOpen} onOpenChange={(open) => (deleting ? undefined : setDeleteOpen(open))} size="sm">
        <DialogHeader>
          <DialogTitle>Delete {editing}?</DialogTitle>
          <DialogDescription>
            Removes <code className="font-mono">{editing ? skillPath(editing) : ""}</code> from your workspace. Agents stop using it
            right away. This cannot be undone.
          </DialogDescription>
        </DialogHeader>
        <DialogFooter>
          <Button variant="ghost" size="sm" onClick={() => setDeleteOpen(false)} disabled={deleting} data-autofocus>
            Cancel
          </Button>
          <Button variant="danger" size="sm" onClick={() => void deleteSkill()} loading={deleting}>
            Delete skill
          </Button>
        </DialogFooter>
      </Dialog>

      <Dialog open={discardOpen} onOpenChange={setDiscardOpen} size="sm">
        <DialogHeader>
          <DialogTitle>Discard your changes?</DialogTitle>
          <DialogDescription>Your edits to {editing} have not been saved.</DialogDescription>
        </DialogHeader>
        <DialogFooter>
          <Button variant="ghost" size="sm" onClick={() => setDiscardOpen(false)} data-autofocus>
            Keep editing
          </Button>
          <Button variant="danger" size="sm" onClick={closeEditor}>
            Discard changes
          </Button>
        </DialogFooter>
      </Dialog>
    </>
  )

  if (editing) {
    return (
      <div className="flex flex-col gap-4">
        <div className="flex items-center gap-3">
          <Button variant="ghost" size="sm" onClick={requestCloseEditor} className="-ml-2">
            <ArrowLeft />
            All skills
          </Button>
          <div className="ml-auto flex items-center gap-1.5">
            <Button variant="ghost" size="sm" onClick={() => setDeleteOpen(true)} disabled={saving || contentLoading}>
              Delete
            </Button>
            <Button size="sm" onClick={() => void saveSkill()} loading={saving} disabled={!dirty || contentLoading}>
              Save
            </Button>
          </div>
        </div>
        <div>
          <h3 className="font-mono text-md font-medium text-fg">{editing}</h3>
          <p className="mt-0.5 font-mono text-xs text-muted">{skillPath(editing)}</p>
        </div>
        {contentLoading ? (
          <SettingsLoading label="Loading SKILL.md" />
        ) : (
          <Textarea
            aria-label={`${editing} SKILL.md`}
            value={content}
            onChange={(e) => {
              setContent(e.target.value)
              setDirty(true)
            }}
            spellCheck={false}
            autoCorrect="off"
            autoCapitalize="off"
            data-gramm="false"
            data-gramm_editor="false"
            data-enable-grammarly="false"
            mono
            rows={20}
            className="min-h-80 resize-y leading-5"
          />
        )}
        <div className="flex items-start justify-between gap-3 text-xs">
          <span className="font-mono tabular-nums text-faint">{content.length.toLocaleString("en-US")} characters</span>
          {editorError ? (
            <span className="text-right text-danger" role="alert">
              {editorError}
            </span>
          ) : dirty ? (
            <span className="text-warning">Unsaved changes</span>
          ) : null}
        </div>
        {validationErrors.length > 0 ? (
          <ul className="flex flex-col gap-1 rounded-md border border-border bg-warning-muted px-3 py-2 text-xs text-fg">
            {validationErrors.map((item) => (
              <li key={item}>{item}</li>
            ))}
          </ul>
        ) : null}
        {dialogs}
      </div>
    )
  }

  if (!skills && !loadError) return <SettingsLoading label="Loading skills" />
  if (!skills) return <SettingsLoadError title="Skills did not load" message={loadError ?? "Try again."} onRetry={() => void fetchSkills()} />

  return (
    <div className="flex flex-col gap-4">
      {skills.length === 0 ? (
        <EmptyState
          icon={<FileCode2 />}
          title="No skills yet"
          description="A skill is a SKILL.md file with instructions agents follow when a request matches. Start from the starter set or write your own."
          action={
            <div className="flex items-center gap-2">
              <Button variant="secondary" size="sm" onClick={() => void installStarters()} loading={installing}>
                Install starter skills
              </Button>
              <Button size="sm" onClick={() => setCreateOpen(true)}>
                <Plus />
                New skill
              </Button>
            </div>
          }
        />
      ) : (
        <SettingsGroup
          title="Your skills"
          description="All of these are available to agents. Select one to edit its SKILL.md."
          actions={
            <Button size="sm" onClick={() => setCreateOpen(true)}>
              <Plus />
              New skill
            </Button>
          }
        >
          <Table density="compact">
            <THead>
              <tr>
                <Th>Skill</Th>
                <Th>File</Th>
                <Th numeric>Updated</Th>
              </tr>
            </THead>
            <TBody>
              {skills.map((skill) => (
                <Tr
                  key={skill.name}
                  interactive
                  tabIndex={0}
                  aria-label={`Edit ${skill.name}`}
                  onClick={() => void openSkill(skill.name)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" || e.key === " ") {
                      e.preventDefault()
                      void openSkill(skill.name)
                    }
                  }}
                >
                  <Td className="max-w-0 w-1/2">
                    <span className="block truncate font-mono text-xs text-fg">{skill.name}</span>
                    {skill.description ? <span className="block truncate text-xs text-muted">{skill.description}</span> : null}
                  </Td>
                  <Td mono muted className="whitespace-nowrap">
                    {skillPath(skill.name)}
                  </Td>
                  <Td numeric mono muted className="whitespace-nowrap">
                    {formatUpdated(skill.updatedAt)}
                  </Td>
                </Tr>
              ))}
            </TBody>
          </Table>
        </SettingsGroup>
      )}
      {dialogs}
    </div>
  )
}
