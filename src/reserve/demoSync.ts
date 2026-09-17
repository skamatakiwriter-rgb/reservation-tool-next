export type DemoChange = {
  type: 'reservation' | 'status' | 'setting' | 'closure' | 'reset' | 'deleted'
  targetId?: string
  occurredAt: string
}

const channelName = 'reservation-management-public-demo-sync'
const localEventName = 'reservation-demo-change'
let channel: BroadcastChannel | undefined

function getChannel(): BroadcastChannel | undefined {
  if (channel || typeof BroadcastChannel === 'undefined') return channel
  channel = new BroadcastChannel(channelName)
  return channel
}

export function publishDemoChange(type: DemoChange['type'], targetId?: string): void {
  const change: DemoChange = { type, targetId, occurredAt: new Date().toISOString() }
  getChannel()?.postMessage(change)
  if (typeof window !== 'undefined') window.dispatchEvent(new CustomEvent<DemoChange>(localEventName, { detail: change }))
}

export function subscribeToDemoChanges(listener: (change: DemoChange) => void): () => void {
  const broadcast = getChannel()
  const onMessage = (event: MessageEvent<DemoChange>) => listener(event.data)
  const onLocal = (event: Event) => listener((event as CustomEvent<DemoChange>).detail)
  broadcast?.addEventListener('message', onMessage)
  window.addEventListener(localEventName, onLocal)
  return () => {
    broadcast?.removeEventListener('message', onMessage)
    window.removeEventListener(localEventName, onLocal)
  }
}
