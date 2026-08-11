import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'

import { App } from './App'

describe('App', () => {
  it('presents the named game workspace while the campaign is connecting', () => {
    render(<App />)

    expect(screen.getByRole('main', { name: 'PERMISSION ZERO' })).toBeInTheDocument()
    expect(screen.getByText('서비스 연결 중')).toBeInTheDocument()
  })
})
