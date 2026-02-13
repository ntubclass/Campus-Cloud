import { useSuspenseQuery } from "@tanstack/react-query"
import { createFileRoute } from "@tanstack/react-router"
import { FileText } from "lucide-react"
import { Suspense } from "react"

import { VmRequestsService } from "@/client"
import { myRequestColumns } from "@/components/Applications/columns"
import CreateVMRequest from "@/components/Applications/CreateVMRequest"
import { DataTable } from "@/components/Common/DataTable"
import PendingItems from "@/components/Pending/PendingItems"

function getMyRequestsQueryOptions() {
  return {
    queryFn: () => VmRequestsService.listMyVmRequests({}),
    queryKey: ["vm-requests"],
  }
}

export const Route = createFileRoute("/_layout/applications")({
  component: Applications,
  head: () => ({
    meta: [
      {
        title: "Applications - Campus Cloud",
      },
    ],
  }),
})

function RequestsTableContent() {
  const { data } = useSuspenseQuery(getMyRequestsQueryOptions())

  if (data.data.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center text-center py-12">
        <div className="rounded-full bg-muted p-4 mb-4">
          <FileText className="h-8 w-8 text-muted-foreground" />
        </div>
        <h3 className="text-lg font-semibold">尚無申請紀錄</h3>
        <p className="text-muted-foreground">
          點擊「申請資源」按鈕來提交您的第一個虛擬機申請
        </p>
      </div>
    )
  }

  return <DataTable columns={myRequestColumns} data={data.data} />
}

function RequestsTable() {
  return (
    <Suspense fallback={<PendingItems />}>
      <RequestsTableContent />
    </Suspense>
  )
}

function Applications() {
  return (
    <div className="flex flex-col gap-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">我的申請</h1>
          <p className="text-muted-foreground">
            查看您的虛擬機/容器申請紀錄與審核狀態
          </p>
        </div>
        <CreateVMRequest />
      </div>
      <RequestsTable />
    </div>
  )
}
