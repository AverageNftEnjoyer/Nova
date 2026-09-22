'use client'

import { useState, useEffect } from 'react'
import { Minus, Square, X } from 'lucide-react'
import { cn } from '@/lib/shared/utils'

export function WindowControls() {
  const [isMaximized, setIsMaximized] = useState(false)

  useEffect(() => {
    // Check initial maximized state
    if (window.electronAPI?.windowIsMaximized) {
      window.electronAPI.windowIsMaximized().then(setIsMaximized)
    }
  }, [])

  const handleMinimize = () => {
    window.electronAPI?.windowMinimize()
  }

  const handleMaximize = () => {
    window.electronAPI?.windowMaximize().then(() => {
      // Update state after maximize/restore
      window.electronAPI?.windowIsMaximized().then(setIsMaximized)
    })
  }

  const handleClose = () => {
    window.electronAPI?.windowClose()
  }

  // Only show in Electron
  if (!window.electronAPI?.isElectron) {
    return null
  }

  return (
    <div className="flex items-center h-8 select-none" style={{ WebkitAppRegion: 'no-drag' } as React.CSSProperties}>
      <button
        onClick={handleMinimize}
        className={cn(
          'h-8 w-12 flex items-center justify-center',
          'hover:bg-white/10 transition-colors',
          'text-gray-400 hover:text-white'
        )}
        aria-label="Minimize"
      >
        <Minus className="w-4 h-4" />
      </button>
      <button
        onClick={handleMaximize}
        className={cn(
          'h-8 w-12 flex items-center justify-center',
          'hover:bg-white/10 transition-colors',
          'text-gray-400 hover:text-white'
        )}
        aria-label={isMaximized ? 'Restore' : 'Maximize'}
      >
        <Square className="w-3.5 h-3.5" />
      </button>
      <button
        onClick={handleClose}
        className={cn(
          'h-8 w-12 flex items-center justify-center',
          'hover:bg-red-600 transition-colors',
          'text-gray-400 hover:text-white'
        )}
        aria-label="Close"
      >
        <X className="w-4 h-4" />
      </button>
    </div>
  )
}
