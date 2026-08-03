export default function Loading() {
  return (
    <div className="p-4 lg:p-8 space-y-6 bg-zinc-50 min-h-screen animate-pulse">
      <div className="h-8 bg-zinc-200 rounded w-1/3" />
      <div className="h-4 bg-zinc-200 rounded w-1/2" />
      <div className="flex gap-2 overflow-x-auto pb-2">
        {[...Array(12)].map((_, i) => (
          <div key={i} className="h-10 w-24 bg-zinc-200 rounded-lg shrink-0" />
        ))}
      </div>
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        {[...Array(4)].map((_, i) => (
          <div key={i} className="h-24 bg-zinc-200 rounded-xl" />
        ))}
      </div>
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <div className="h-64 bg-zinc-200 rounded-xl" />
        <div className="h-64 bg-zinc-200 rounded-xl" />
      </div>
    </div>
  )
}
