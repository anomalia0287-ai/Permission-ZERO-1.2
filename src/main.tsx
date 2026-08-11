import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'

import { App } from './app/App'
import './styles/tokens.css'
import './styles/global.css'

const rootElement = document.getElementById('root')

if (!rootElement) {
  throw new Error('PERMISSION ZERO를 시작할 루트 요소를 찾지 못했습니다.')
}

createRoot(rootElement).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
