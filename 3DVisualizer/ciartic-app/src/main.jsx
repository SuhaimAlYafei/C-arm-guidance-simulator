import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import SimulatorShell from './SimulatorShell.jsx'

createRoot(document.getElementById('root')).render(
  <StrictMode>
    <SimulatorShell />
  </StrictMode>,
)
