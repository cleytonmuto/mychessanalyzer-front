import { useEffect, useState, type ReactNode } from 'react'
import type { BoardStyle } from './boardStyle'
import { BoardStyleContext } from './boardStyle'

export function BoardStyleProvider({ children }: { children: ReactNode }) {
  const [style, setStyle] = useState<BoardStyle>(() => {
    const stored = window.localStorage.getItem('board-style')
    return stored === 'oscar' || stored === 'green' || stored === 'gta' ? stored : 'default'
  })
  useEffect(() => {
    window.localStorage.setItem('board-style', style)
  }, [style])
  return <BoardStyleContext.Provider value={{ style, setStyle }}>{children}</BoardStyleContext.Provider>
}
