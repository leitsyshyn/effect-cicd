import { useEffect, useRef } from "react"

export function useEventStream(url: string, onMessage: (event: MessageEvent<string>) => void, eventName = "message") {
  const onMessageRef = useRef(onMessage)

  useEffect(() => {
    onMessageRef.current = onMessage
  }, [onMessage])

  useEffect(() => {
    const eventSource = new EventSource(url)
    const listener: EventListener = (event) => {
      onMessageRef.current(event as MessageEvent<string>)
    }

    eventSource.addEventListener(eventName, listener)

    return () => {
      eventSource.removeEventListener(eventName, listener)
      eventSource.close()
    }
  }, [eventName, url])
}
