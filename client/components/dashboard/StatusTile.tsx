export function StatusTile({
  label,
  value,
  tone = 'default',
}: {
  label: string
  value: string
  tone?: 'default' | 'paid'
}) {
  return (
    <div
      className={`rounded-md border p-4 ${
        tone === 'paid'
          ? 'border-[#edb241]/50 bg-[#17211c] text-[#f7f8f3]'
          : 'border-[#17211c]/10 bg-[#f7f8f3] text-[#17211c]'
      }`}
    >
      <p
        className={`text-sm ${
          tone === 'paid' ? 'text-[#edb241]' : 'text-[#526159]'
        }`}
      >
        {label}
      </p>

      <p className="mt-2 font-semibold capitalize">{value}</p>
    </div>
  )
}