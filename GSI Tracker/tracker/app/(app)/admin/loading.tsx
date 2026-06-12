export default function Loading() {
  return (
    <div className="p-4 lg:p-8 space-y-6 bg-[#0a0a0f] min-h-screen animate-pulse">
      <div className="h-8 bg-zinc-800 rounded w-1/4" />
      <div className="h-4 bg-zinc-800 rounded w-1/3" />
      <div className="flex gap-2 overflow-x-auto pb-1">
        {[...Array(7)].map((_, i) => (
          <div key={i} className="h-9 w-28 bg-zinc-800 rounded-md shrink-0" />
        ))}
      </div>
      <div className="h-96 bg-zinc-800 rounded-xl" />
    </div>
  )
}
