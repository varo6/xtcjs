import { createFileRoute } from '@tanstack/react-router'
import { ConverterPage } from '../components/ConverterPage'

export const Route = createFileRoute('/pdf')({
  component: PdfPage,
})

function PdfPage() {
  return (
    <ConverterPage
      fileType="pdf"
      notice="At the moment PDF conversion uses the same processing as CBZ, with different options selection. Try Atkinson Max or Strong."
    />
  )
}
