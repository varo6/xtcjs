import { createFileRoute } from '@tanstack/react-router'
import { MergePage } from '../components/MergePage'

export const Route = createFileRoute('/merge')({
  component: MergeSplitPage,
})

function MergeSplitPage() {
  return <MergePage />
}
