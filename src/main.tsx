import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './styles.css'
import App from './App.tsx'
import { useEditor } from './store'

if (import.meta.env.DEV) {
  ;(window as unknown as { __pdfEditor?: typeof useEditor }).__pdfEditor = useEditor
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
