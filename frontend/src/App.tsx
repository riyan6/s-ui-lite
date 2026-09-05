import { Navigate, Route, Routes } from 'react-router-dom'
import type { ReactNode } from 'react'
import { getToken } from './api/client'
import MainLayout from './layouts/MainLayout'
import Login from './pages/Login'
import ForcePassword from './pages/ForcePassword'
import Dashboard from './pages/Dashboard'
import Inbounds from './pages/Inbounds'
import Outbounds from './pages/Outbounds'
import Routing from './pages/Routing'
import Dns from './pages/Dns'
import Services from './pages/Services'
import Runtime from './pages/Runtime'
import Settings from './pages/Settings'

function RequireToken({ children }: { children: ReactNode }) {
  if (!getToken()) {
    return <Navigate to="/login" replace />
  }
  return <>{children}</>
}

export default function App() {
  return (
    <Routes>
      <Route path="/login" element={<Login />} />
      <Route
        path="/force-password"
        element={
          <RequireToken>
            <ForcePassword />
          </RequireToken>
        }
      />
      <Route
        element={
          <RequireToken>
            <MainLayout />
          </RequireToken>
        }
      >
        <Route path="/" element={<Dashboard />} />
        <Route path="/inbounds" element={<Inbounds />} />
        <Route path="/outbounds" element={<Outbounds />} />
        <Route path="/routing" element={<Routing />} />
        <Route path="/dns" element={<Dns />} />
        <Route path="/services" element={<Services />} />
        <Route path="/runtime" element={<Runtime />} />
        <Route path="/logs" element={<Navigate to="/runtime" replace />} />
        <Route path="/settings" element={<Settings />} />
      </Route>
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  )
}
