export default function Loading() {
  return (
    <div className="p-4 lg:p-8 space-y-6 max-w-7xl mx-auto bg-[#0a0a0f] min-h-screen animate-pulse">
      <div className="space-y-2">
        <div className="h-8 bg-zinc-800 rounded w-1/4" />
        <div className="h-4 bg-zinc-800 rounded w-1/3" />
      </div>
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        {Array.from({ length: 4 }).map((_, i) => (
          <div key={i} className="h-28 bg-zinc-800 rounded-xl" />
        ))}
      </div>
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        <div className="lg:col-span-2 h-96 bg-zinc-800 rounded-xl" />
        <div className="h-96 bg-zinc-800 rounded-xl" />
      </div>
    </div>
  )
}
