import { fireEvent, render, screen } from '@testing-library/react'
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

  it('connects the one-screen entries to their full detail panels', () => {
    render(<App />)

    fireEvent.click(screen.getByRole('button', { name: '시장 통계 열기' }))
    expect(screen.getByRole('region', { name: '상세 통계' })).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: '통계 닫기' }))

    fireEvent.click(screen.getByRole('button', { name: '설정' }))
    expect(screen.getByRole('region', { name: '게임 설정' })).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: '조작 가이드 열기' }))
    expect(screen.getByRole('region', { name: '게임 가이드' })).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: '가이드 닫기' }))

    fireEvent.click(screen.getByRole('button', { name: '설정' }))
    fireEvent.click(screen.getByRole('button', { name: '작품 크레딧 열기' }))
    expect(screen.getByRole('region', { name: '작품 크레딧' })).toBeInTheDocument()
  })

  it('opens the hacking network from the unauthorized subsystem entry', () => {
    render(<App />)

    fireEvent.click(screen.getByRole('button', { name: /해킹 네트워크/ }))
    expect(screen.getByRole('region', { name: '해킹 네트워크' })).toBeInTheDocument()
    fireEvent.keyDown(window, { key: 'Escape' })
    expect(screen.queryByRole('region', { name: '해킹 네트워크' })).not.toBeInTheDocument()
  })
})
