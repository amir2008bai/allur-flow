import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App'
import { startNet } from './net'
import { installPinFetch } from './pin'

installPinFetch()
startNet()

createRoot(document.getElementById('root')!).render(<App />)
