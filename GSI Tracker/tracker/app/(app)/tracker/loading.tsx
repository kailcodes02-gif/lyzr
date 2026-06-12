export default function Loading() {
  return (
    <div className="p-4 lg:p-8 space-y-6 bg-[#0a0a0f] min-h-screen animate-pulse">
      <div className="space-y-2">
        <div className="h-8 bg-zinc-800 rounded w-1/4" />
        <div className="h-4 bg-zinc-800 rounded w-1/2" />
      </div>
      <div className="h-20 bg-zinc-800/60 rounded-xl" />
      <div className="rounded-xl border border-white/5 bg-zinc-900/30 overflow-hidden">
        <div className="h-10 bg-zinc-800/60 border-b border-white/5" />
        <div className="divide-y divide-white/5">
          {Array.from({ length: 8 }).map((_, i) => (
            <div key={i} className="h-12 bg-zinc-800/30" />
          ))}
        </div>
      </div>
    </div>
  )
}
