import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import App from './App.tsx'
import { BoardStyleProvider } from './BoardStyleProvider.tsx'
import './index.css'

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <BoardStyleProvider>
      <App />
    </BoardStyleProvider>
  </StrictMode>,
)
