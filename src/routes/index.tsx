import { createFileRoute } from '@tanstack/react-router'
import { ConverterPage } from '../components/ConverterPage'

export const Route = createFileRoute('/')({
  component: MangaPage,
})

function MangaPage() {
  return (
    <ConverterPage
      fileType="cbz"
      notice="A CBZ -> XTC converter for your manga. Recommended settings are selected by default"
    />
  )
}
