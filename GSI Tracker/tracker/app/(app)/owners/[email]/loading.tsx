export default function Loading() {
  return (
    <div className="p-4 lg:p-8 space-y-6 max-w-7xl mx-auto bg-[#0a0a0f] min-h-screen animate-pulse">
      <div className="h-3 bg-zinc-800 rounded w-32" />
      <div className="flex items-center gap-4">
        <div className="w-16 h-16 rounded-full bg-zinc-800" />
        <div className="space-y-2 flex-1 max-w-xs">
          <div className="h-6 bg-zinc-800 rounded w-3/4" />
          <div className="h-3 bg-zinc-800 rounded w-1/2" />
        </div>
      </div>
      <div className="h-10 bg-zinc-800/60 rounded-lg max-w-md" />
      <div className="h-96 bg-zinc-800/40 rounded-xl" />
    </div>
  )
}
