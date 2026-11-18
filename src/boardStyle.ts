import { createContext, useContext } from 'react'

export type BoardStyle = 'default' | 'oscar' | 'green' | 'gta'

export const BoardStyleContext = createContext<{
  style: BoardStyle
  setStyle: (style: BoardStyle) => void
}>({ style: 'default', setStyle: () => {} })

export function useBoardStyle() {
  return useContext(BoardStyleContext)
}
