import { AdminUser } from "@/lib/types"
import { Users } from "lucide-react"
import { Pill } from "./PIll"
import { formatDate } from "@/lib/utils"

export function AdminUsersPanel({
  users,
  totalUsers,
  isLoading,
  error,
}: {
  users: AdminUser[]
  totalUsers: number
  isLoading: boolean
  error: string
}) {
  return (
    <div className="mt-5 rounded-lg border border-[#17211c]/10 bg-white shadow-sm">
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-[#17211c]/10 p-5">
        <div>
          <div className="flex items-center gap-2 text-sm font-medium text-[#1f7159]">
            <Users className="size-4" />
            Admin
          </div>

          <h2 className="mt-2 text-2xl font-semibold">Users and status</h2>
        </div>

        <span className="rounded-md bg-[#eef2ec] px-3 py-2 text-sm font-medium text-[#526159]">
          {totalUsers} total
        </span>
      </div>

      {error ? (
        <p className="m-5 rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
          {error}
        </p>
      ) : null}

      <div className="overflow-x-auto">
        <table className="w-full min-w-245 border-collapse text-left text-sm">
          <thead className="bg-[#f7f8f3] text-[#526159]">
            <tr>
              {[
                'User',
                'Role',
                'Service',
                'Payment',
                'Email',
                'Access',
                'Created',
                'Updated',
              ].map((heading) => (
                <th key={heading} className="px-5 py-3 font-medium">
                  {heading}
                </th>
              ))}
            </tr>
          </thead>

          <tbody>
            {isLoading ? (
              <tr>
                <td className="px-5 py-6 text-[#526159]" colSpan={8}>
                  Loading users...
                </td>
              </tr>
            ) : null}

            {!isLoading && users.length === 0 ? (
              <tr>
                <td className="px-5 py-6 text-[#526159]" colSpan={8}>
                  No users found.
                </td>
              </tr>
            ) : null}

            {users.map((item) => (
              <tr
                key={item.id}
                className="border-t border-[#17211c]/10 align-top"
              >
                <td className="px-5 py-4">
                  <p className="font-medium text-[#17211c]">{item.name}</p>
                  <p className="mt-1 text-[#526159]">{item.email}</p>
                </td>

                <td className="px-5 py-4">
                  <Pill tone={item.role === 'admin' ? 'green' : 'neutral'}>
                    {item.role ?? 'user'}
                  </Pill>
                </td>

                <td className="px-5 py-4">
                  <Pill tone="gold">{item.serviceType ?? 'free'}</Pill>
                </td>

                <td className="px-5 py-4">
                  <Pill tone={item.paid ? 'green' : 'neutral'}>
                    {item.paid ? 'paid' : 'unpaid'}
                  </Pill>
                </td>

                <td className="px-5 py-4">
                  <Pill tone={item.emailVerified ? 'green' : 'neutral'}>
                    {item.emailVerified ? 'verified' : 'unverified'}
                  </Pill>
                </td>

                <td className="px-5 py-4">
                  <Pill tone={item.banned ? 'red' : 'green'}>
                    {item.banned ? 'blocked' : 'active'}
                  </Pill>

                  {item.banReason ? (
                    <p className="mt-2 max-w-48 text-xs leading-5 text-[#526159]">
                      {item.banReason}
                    </p>
                  ) : null}
                </td>

                <td className="px-5 py-4 text-[#526159]">
                  {formatDate(item.createdAt)}
                </td>

                <td className="px-5 py-4 text-[#526159]">
                  {formatDate(item.updatedAt)}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}