export function Pill({
  children,
  tone,
}: {
  children: React.ReactNode
  tone: 'green' | 'gold' | 'red' | 'neutral'
}) {
  const tones = {
    green: 'bg-[#e8f2ee] text-[#1f7159]',
    gold: 'bg-[#fff4d7] text-[#7a4c00]',
    red: 'bg-red-50 text-red-700',
    neutral: 'bg-[#eef2ec] text-[#526159]',
  }

  return (
    <span
      className={`inline-flex rounded-md px-2.5 py-1 text-xs font-medium capitalize ${tones[tone]}`}
    >
      {children}
    </span>
  )
}
