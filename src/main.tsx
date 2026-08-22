import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'

import { App } from './app/App'
import './styles/tokens.css'
import './styles/global.css'
import './styles/operations-shell.css'
import './styles/connected-details.css'
import './styles/hacking.css'
import './styles/statistics.css'
import './styles/settings.css'
import './styles/overlays.css'
import './styles/motion.css'
import './styles/modern-sf.css'
import './styles/retrofuture.css'
import './styles/retro-modern-remodel.css'
import './styles/expansion-stage.css'
import './styles/title-screen.css'
import './styles/tutorial.css'
import './styles/resource-snake.css'

const rootElement = document.getElementById('root')

if (!rootElement) {
  throw new Error('PERMISSION ZERO를 시작할 루트 요소를 찾지 못했습니다.')
}

createRoot(rootElement).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
