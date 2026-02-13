import { useMutation, useQueryClient } from "@tanstack/react-query"
import { Check, X } from "lucide-react"
import { useState } from "react"
import { useForm } from "react-hook-form"

import { type VMRequestPublic, VmRequestsService } from "@/client"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { LoadingButton } from "@/components/ui/loading-button"
import { Textarea } from "@/components/ui/textarea"
import useCustomToast from "@/hooks/useCustomToast"
import { handleError } from "@/utils"

interface ReviewDialogProps {
  request: VMRequestPublic
  action: "approved" | "rejected"
  open: boolean
  onOpenChange: (open: boolean) => void
}

const ReviewDialog = ({
  request,
  action,
  open,
  onOpenChange,
}: ReviewDialogProps) => {
  const queryClient = useQueryClient()
  const { showSuccessToast, showErrorToast } = useCustomToast()
  const { handleSubmit } = useForm()
  const [comment, setComment] = useState("")

  const mutation = useMutation({
    mutationFn: () =>
      VmRequestsService.reviewVmRequest({
        requestId: request.id,
        requestBody: {
          status: action,
          review_comment: comment || null,
        },
      }),
    onSuccess: () => {
      const msg = action === "approved" ? "已通過，虛擬機正在建立中" : "已拒絕申請"
      showSuccessToast(msg)
      onOpenChange(false)
      setComment("")
    },
    onError: handleError.bind(showErrorToast),
    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: ["vm-requests-admin"] })
    },
  })

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <form onSubmit={handleSubmit(() => mutation.mutate())}>
          <DialogHeader>
            <DialogTitle>
              {action === "approved" ? "通過申請" : "拒絕申請"}
            </DialogTitle>
            <DialogDescription>
              {action === "approved"
                ? `確認通過此申請後，將自動建立 ${request.resource_type === "lxc" ? "LXC 容器" : "QEMU 虛擬機"} 並啟動。`
                : "確認拒絕此申請？"}
            </DialogDescription>
          </DialogHeader>

          <div className="py-4 space-y-4">
            <div className="rounded-lg border p-3 space-y-2 text-sm">
              <div className="flex justify-between">
                <span className="text-muted-foreground">申請者</span>
                <span>{request.user_full_name || request.user_email}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-muted-foreground">主機名稱</span>
                <span className="font-medium">{request.hostname}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-muted-foreground">類型</span>
                <Badge variant="secondary">
                  {request.resource_type === "lxc" ? "LXC" : "QEMU"}
                </Badge>
              </div>
              <div className="flex justify-between">
                <span className="text-muted-foreground">規格</span>
                <span>
                  {request.cores} Core / {(request.memory / 1024).toFixed(1)} GB RAM
                </span>
              </div>
              <div>
                <span className="text-muted-foreground">申請原因</span>
                <p className="mt-1 text-sm">{request.reason}</p>
              </div>
            </div>

            <div>
              <label className="text-sm font-medium">審核備註（選填）</label>
              <Textarea
                placeholder="輸入審核備註..."
                value={comment}
                onChange={(e) => setComment(e.target.value)}
                className="mt-1"
              />
            </div>
          </div>

          <DialogFooter>
            <DialogClose asChild>
              <Button variant="outline" disabled={mutation.isPending}>
                取消
              </Button>
            </DialogClose>
            <LoadingButton
              type="submit"
              loading={mutation.isPending}
              variant={action === "approved" ? "default" : "destructive"}
            >
              {action === "approved" ? "確認通過" : "確認拒絕"}
            </LoadingButton>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}

interface ReviewActionsProps {
  request: VMRequestPublic
}

export const ReviewActions = ({ request }: ReviewActionsProps) => {
  const [approveOpen, setApproveOpen] = useState(false)
  const [rejectOpen, setRejectOpen] = useState(false)

  if (request.status !== "pending") {
    const statusMap: Record<string, { label: string; variant: "default" | "destructive" | "outline" }> = {
      approved: { label: "已通過", variant: "default" },
      rejected: { label: "已拒絕", variant: "destructive" },
    }
    const s = statusMap[request.status]
    return (
      <div className="flex items-center gap-2">
        <Badge variant={s?.variant || "outline"}>{s?.label || request.status}</Badge>
        {request.vmid && (
          <span className="text-xs text-muted-foreground">VMID: {request.vmid}</span>
        )}
      </div>
    )
  }

  return (
    <div className="flex gap-2">
      <Button
        size="sm"
        variant="default"
        onClick={() => setApproveOpen(true)}
      >
        <Check className="mr-1 h-4 w-4" />
        通過
      </Button>
      <Button
        size="sm"
        variant="destructive"
        onClick={() => setRejectOpen(true)}
      >
        <X className="mr-1 h-4 w-4" />
        拒絕
      </Button>

      <ReviewDialog
        request={request}
        action="approved"
        open={approveOpen}
        onOpenChange={setApproveOpen}
      />
      <ReviewDialog
        request={request}
        action="rejected"
        open={rejectOpen}
        onOpenChange={setRejectOpen}
      />
    </div>
  )
}
