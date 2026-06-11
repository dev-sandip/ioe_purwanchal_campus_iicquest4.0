import { ConsoleUser } from "@/lib/types"
import { BadgeCheck } from "lucide-react"
import { StatusTile } from "./StatusTile"
import { formatDate } from "@/lib/utils"

export function UserStatusPanel({
  user,
  serviceType,
}: {
  user: ConsoleUser
  serviceType: NonNullable<ConsoleUser['serviceType']>
}) {
  return (
    <div
      className={`mt-5 rounded-lg border p-5 shadow-sm ${
        user.paid
          ? 'border-[#edb241]/50 bg-[#fffaf0]'
          : 'border-[#17211c]/10 bg-white'
      }`}
    >
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 className="text-xl font-semibold">Account status</h2>

        {user.paid ? (
          <span className="inline-flex items-center gap-2 rounded-md bg-[#17211c] px-3 py-2 text-sm font-medium text-[#edb241]">
            <BadgeCheck className="size-4" />
            Paid access enabled
          </span>
        ) : null}
      </div>

      <div className="mt-5 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <StatusTile label="Service" value={serviceType} />

        <StatusTile
          label="Payment"
          value={user.paid ? 'Paid' : 'Unpaid'}
          tone={user.paid ? 'paid' : 'default'}
        />

        <StatusTile
          label="Email"
          value={user.emailVerified ? 'Verified' : 'Unverified'}
        />

        <StatusTile label="Access" value={user.banned ? 'Blocked' : 'Active'} />

        <StatusTile
          label="Joined"
          value={formatDate(user.createdAt) ?? 'Not available'}
        />
      </div>
    </div>
  )
}