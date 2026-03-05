export default function AgentsLoading() {
  return (
    <div className="relative flex h-dvh overflow-hidden bg-[#0a0a0f] text-slate-100">
      <div className="relative z-10 flex h-full w-full flex-col px-4 py-4 sm:px-6">
        <div className="mb-4 h-14 rounded-2xl border border-white/10 bg-white/5" />
        <div className="mb-4 grid grid-cols-2 gap-2 md:grid-cols-4">
          <div className="h-20 rounded-2xl border border-white/10 bg-white/5" />
          <div className="h-20 rounded-2xl border border-white/10 bg-white/5" />
          <div className="h-20 rounded-2xl border border-white/10 bg-white/5" />
          <div className="h-20 rounded-2xl border border-white/10 bg-white/5" />
        </div>
        <div className="min-h-0 flex-1 rounded-2xl border border-white/10 bg-white/5" />
      </div>
    </div>
  )
}
