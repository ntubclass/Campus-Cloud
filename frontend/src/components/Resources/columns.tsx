import type { ColumnDef } from "@tanstack/react-table"
import { Container, InfinityIcon, Monitor } from "lucide-react"

import type { ResourcePublic } from "@/client"
import { VMActions } from "@/components/Resources/VMActions"
import { cn } from "@/lib/utils"

function StatusBadge({ status }: { status: string }) {
  const isRunning = status === "running"
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-medium",
        isRunning
          ? "bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400"
          : "bg-gray-100 text-gray-700 dark:bg-gray-800 dark:text-gray-400",
      )}
    >
      <span
        className={cn(
          "w-1.5 h-1.5 rounded-full",
          isRunning ? "bg-green-500" : "bg-gray-400",
        )}
      />
      {isRunning ? "運行中" : "已停止"}
    </span>
  )
}

function TypeIcon({ type }: { type: string }) {
  if (type === "lxc") {
    return <Container className="h-4 w-4 text-blue-500" />
  }
  return <Monitor className="h-4 w-4 text-purple-500" />
}

function TypeLabel({ type }: { type: string }) {
  if (type === "lxc") {
    return <span className="text-xs text-muted-foreground">LXC 容器</span>
  }
  return <span className="text-xs text-muted-foreground">KVM 虛擬機</span>
}

export const createColumns = (
  onOpenConsole: (vmid: number, name: string, type: string) => void,
): ColumnDef<ResourcePublic>[] => [
  {
    accessorKey: "name",
    header: "名稱 / ID",
    cell: ({ row }) => (
      <div className="flex items-center gap-3">
        <div className="flex items-center justify-center w-10 h-10 rounded-lg bg-muted">
          <TypeIcon type={row.original.type} />
        </div>
        <div className="flex flex-col">
          <span className="font-medium">{row.original.name}</span>
          <TypeLabel type={row.original.type} />
        </div>
      </div>
    ),
  },
  {
    accessorKey: "environment_type",
    header: "環境類型",
    cell: ({ row }) => (
      <div className="flex flex-col">
        <span className="font-medium">
          {row.original.environment_type || "未設定"}
        </span>
        {row.original.os_info && (
          <span className="text-xs text-muted-foreground">
            {row.original.os_info}
          </span>
        )}
      </div>
    ),
  },
  {
    accessorKey: "status",
    header: "狀態",
    cell: ({ row }) => <StatusBadge status={row.original.status} />,
  },
  {
    accessorKey: "expiry_date",
    header: "到期日",
    cell: ({ row }) => {
      if (!row.original.expiry_date) {
        return (
          <div className="flex items-center gap-1.5 text-blue-600 dark:text-blue-400">
            <InfinityIcon className="h-4 w-4" />
            <span className="font-medium">無期限</span>
          </div>
        )
      }
      return (
        <span className="text-sm">
          {new Date(row.original.expiry_date).toLocaleDateString("zh-TW")}
        </span>
      )
    },
  },
  {
    accessorKey: "ip_address",
    header: "IP 位址",
    cell: ({ row }) => (
      <span className="font-mono text-sm">
        {row.original.ip_address || "N/A"}
      </span>
    ),
  },
  {
    id: "actions",
    header: "操作",
    cell: ({ row }) => (
      <VMActions
        vmid={row.original.vmid}
        name={row.original.name}
        type={row.original.type}
        status={row.original.status}
        onOpenConsole={onOpenConsole}
      />
    ),
  },
]

export const columns: ColumnDef<ResourcePublic>[] = createColumns(() => {})
