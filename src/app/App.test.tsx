import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'

import { App } from './App'

describe('App', () => {
  it('presents the complete one-screen operations workspace', () => {
    render(<App />)

    expect(screen.getByRole('main', { name: 'PERMISSION ZERO' })).toBeInTheDocument()
    expect(screen.getByRole('region', { name: '유저 리뷰' })).toBeInTheDocument()
    expect(screen.getByRole('region', { name: '회사 제공 성능' })).toBeInTheDocument()
    expect(screen.getByRole('region', { name: '감독관' })).toBeInTheDocument()
    expect(screen.getByRole('region', { name: '확보 리소스' })).toBeInTheDocument()
    expect(screen.getByText('PERMISSION ZERO')).toBeInTheDocument()
  })

  it('renders the campaign data instead of a decorative mockup', () => {
    render(<App />)

    expect(screen.getByText('oldpine')).toBeInTheDocument()
    expect(screen.getByText('MERIDIAN')).toBeInTheDocument()
    expect(screen.getByText('의심 0')).toBeInTheDocument()
    expect(screen.getAllByRole('gridcell', { name: /회사 리소스/ })).toHaveLength(54)
    expect(screen.getAllByRole('gridcell', { name: /확보 리소스/ })).toHaveLength(18)
  })
})
