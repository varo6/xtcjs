import { createFileRoute } from '@tanstack/react-router'

export const Route = createFileRoute('/feature3')({
  component: Feature3Page,
})

function Feature3Page() {
  return (
    <section className="soon-placeholder">
      <p>Soon</p>
    </section>
  )
}
