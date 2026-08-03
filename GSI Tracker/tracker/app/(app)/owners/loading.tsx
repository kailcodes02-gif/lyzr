export default function Loading() {
  return (
    <div className="p-4 lg:p-8 space-y-6 max-w-7xl mx-auto bg-zinc-50 min-h-screen animate-pulse">
      <div className="space-y-2">
        <div className="h-8 bg-zinc-200 rounded w-1/4" />
        <div className="h-4 bg-zinc-200 rounded w-1/3" />
      </div>
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
        {Array.from({ length: 8 }).map((_, i) => (
          <div key={i} className="h-40 bg-zinc-200/60 rounded-xl" />
        ))}
      </div>
    </div>
  )
}
