import type { ColumnDef } from "@tanstack/react-table"

import type { VMRequestPublic } from "@/client"
import { Badge } from "@/components/ui/badge"

const statusMap: Record<string, { label: string; variant: "default" | "secondary" | "destructive" | "outline" }> = {
  pending: { label: "待審核", variant: "outline" },
  approved: { label: "已通過", variant: "default" },
  rejected: { label: "已拒絕", variant: "destructive" },
}

export const myRequestColumns: ColumnDef<VMRequestPublic>[] = [
  {
    accessorKey: "hostname",
    header: "主機名稱",
    cell: ({ row }) => (
      <span className="font-medium">{row.original.hostname}</span>
    ),
  },
  {
    accessorKey: "resource_type",
    header: "類型",
    cell: ({ row }) => (
      <Badge variant="secondary">
        {row.original.resource_type === "lxc" ? "LXC 容器" : "QEMU 虛擬機"}
      </Badge>
    ),
  },
  {
    accessorKey: "reason",
    header: "申請原因",
    cell: ({ row }) => (
      <span className="text-muted-foreground line-clamp-2 max-w-[300px]">
        {row.original.reason}
      </span>
    ),
  },
  {
    accessorKey: "cores",
    header: "規格",
    cell: ({ row }) => (
      <span className="text-sm text-muted-foreground">
        {row.original.cores} Core / {(row.original.memory / 1024).toFixed(1)} GB
      </span>
    ),
  },
  {
    accessorKey: "status",
    header: "狀態",
    cell: ({ row }) => {
      const s = statusMap[row.original.status] || statusMap.pending
      return <Badge variant={s.variant}>{s.label}</Badge>
    },
  },
  {
    accessorKey: "vmid",
    header: "VMID",
    cell: ({ row }) => (
      <span className="text-muted-foreground">
        {row.original.vmid ?? "-"}
      </span>
    ),
  },
  {
    accessorKey: "created_at",
    header: "申請時間",
    cell: ({ row }) => (
      <span className="text-muted-foreground text-sm">
        {new Date(row.original.created_at).toLocaleString("zh-TW")}
      </span>
    ),
  },
]
