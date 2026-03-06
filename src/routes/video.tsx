import { createFileRoute } from '@tanstack/react-router'
import { ConverterPage } from '../components/ConverterPage'

export const Route = createFileRoute('/video')({
  component: VideoPage,
})

function VideoPage() {
  return (
    <ConverterPage
      fileType="video"
      notice="Extract frames from video files and convert them to XTC or XTCH for animated reading sequences."
    />
  )
}
