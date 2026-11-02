import { useEffect } from 'react'
import { useMutation, useQuery, useQueryClient, type UseQueryOptions } from '@tanstack/react-query'
import type { Channel, EventMap, EventName, In, Out } from '@shared/api'
import { platform } from '../platform'

export const call = <C extends Channel>(channel: C, input: In<C>) => platform.call(channel, input)

export function useApi<C extends Channel>(channel: C, input: In<C>, opts: Omit<UseQueryOptions<Out<C>, Error>, 'queryKey' | 'queryFn'> = {}) {
  return useQuery<Out<C>, Error>({ queryKey: [channel, input], queryFn: () => platform.call(channel, input), ...opts })
}

/** Mutación que invalida los canales indicados al terminar bien. */
export function useApiMutation<C extends Channel>(channel: C, invalidate: Channel[] = []) {
  const qc = useQueryClient()
  return useMutation<Out<C>, Error, In<C>>({
    mutationFn: (input) => platform.call(channel, input),
    onSuccess: () => Promise.all(invalidate.map((c) => qc.invalidateQueries({ queryKey: [c] }))),
  })
}

export function useEvent<E extends EventName>(event: E, listener: (payload: EventMap[E]) => void): void {
  useEffect(() => platform.on(event, listener), [event, listener])
}
