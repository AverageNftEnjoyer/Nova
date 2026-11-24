import { PageContainer } from "@/components/shell/page-container"
import { Skeleton, SkeletonRows } from "@/components/ui/skeleton"

/** Route-level loading state: the shape of a page header and a list, so the layout does not jump when it arrives. */
export default function Loading() {
  return (
    <PageContainer aria-busy="true">
      <div className="flex flex-col gap-2 pb-6">
        <Skeleton className="h-5 w-40" />
        <Skeleton className="h-3.5 w-72" />
      </div>
      <div className="rounded-lg border border-border bg-surface">
        <SkeletonRows rows={6} />
      </div>
    </PageContainer>
  )
}
