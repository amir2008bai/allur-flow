import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App'
import { startNet } from './net'

startNet()

createRoot(document.getElementById('root')!).render(<App />)
