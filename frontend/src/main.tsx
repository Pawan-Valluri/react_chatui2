import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import App from './app/App.tsx'

window.addEventListener("unhandledrejection", (event) => {
  console.error("Unhandled Rejection Stack:", event.reason?.stack || event.reason);
});

window.addEventListener("error", (event) => {
  console.error("Global Error Stack:", event.error?.stack || event.error || event.message);
});

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
)

