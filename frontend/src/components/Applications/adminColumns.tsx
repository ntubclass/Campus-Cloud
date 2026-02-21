import type { ColumnDef } from "@tanstack/react-table"

import type { VMRequestPublic } from "@/client"
import { Badge } from "@/components/ui/badge"
import { ReviewActions } from "./ReviewActions"

export const adminRequestColumns: ColumnDef<VMRequestPublic>[] = [
  {
    accessorKey: "user_full_name",
    header: "申請者",
    cell: ({ row }) => (
      <div className="flex flex-col">
        <span className="font-medium">
          {row.original.user_full_name || "N/A"}
        </span>
        <span className="text-xs text-muted-foreground">
          {row.original.user_email}
        </span>
      </div>
    ),
  },
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
      <span className="text-muted-foreground line-clamp-2 max-w-[250px]">
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
    accessorKey: "created_at",
    header: "申請時間",
    cell: ({ row }) => (
      <span className="text-muted-foreground text-sm">
        {new Date(row.original.created_at).toLocaleString("zh-TW")}
      </span>
    ),
  },
  {
    id: "actions",
    header: "操作",
    cell: ({ row }) => <ReviewActions request={row.original} />,
  },
]
