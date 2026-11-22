export type DeviceId = 'X4' | 'X3' | 'Sticky'

export interface DeviceSpec {
  label: string
  name: string
  width: number
  height: number
  notice?: string
}

export const DEVICES: Record<DeviceId, DeviceSpec> = {
  X4: { label: 'X4 / Pro', name: 'XTEink X4 and X4 Pro', width: 480, height: 800 },
  X3: { label: 'X3', name: 'XTEink X3', width: 528, height: 792 },
  Sticky: {
    label: 'Sticky',
    name: 'Seeed Studio reTerminal Sticky with CrossPoint Reader',
    width: 480,
    height: 800,
    notice: 'Requires CrossPoint Reader firmware. Not compatible with the original Seeed firmware.',
  },
}

export const DEVICE_IDS = Object.keys(DEVICES) as DeviceId[]

export function getTargetDimensions(device: DeviceId): { width: number; height: number } {
  const { width, height } = DEVICES[device]
  return { width, height }
}
