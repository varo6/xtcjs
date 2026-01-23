import { createFileRoute } from '@tanstack/react-router'

export const Route = createFileRoute('/feature4')({
  component: Feature4Page,
})

function Feature4Page() {
  return (
    <section className="soon-placeholder">
      <p>Soon</p>
    </section>
  )
}
