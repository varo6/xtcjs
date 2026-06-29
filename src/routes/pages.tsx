import { createFileRoute } from '@tanstack/react-router'
import { ReplacePagesPage } from '../components/ReplacePagesPage'

export const Route = createFileRoute('/pages')({
  component: ReplacePagesPage,
})
