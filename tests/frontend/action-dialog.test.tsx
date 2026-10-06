// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { ActionDialog } from '@/components/app/action-dialog'
import { ApiRequestError } from '@/lib/api'

vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() } }))

function setup(props: Partial<React.ComponentProps<typeof ActionDialog>> = {}) {
  const onSubmit = vi.fn().mockResolvedValue(undefined)
  const onOpenChange = vi.fn()
  const onDone = vi.fn()
  render(
    <ActionDialog open onOpenChange={onOpenChange} title="Delete account permanently" description="This cannot be undone." confirmLabel="Delete account" destructive typed="DELETE" onSubmit={onSubmit} onDone={onDone} {...props} />,
  )
  return { onSubmit, onOpenChange, onDone }
}

describe('ActionDialog (confirmation before any dangerous action)', () => {
  it('does not send anything until the exact phrase is typed', async () => {
    const { onSubmit } = setup()
    const btn = screen.getByRole('button', { name: 'Delete account' })
    expect(btn).toBeDisabled()
    const box = screen.getByLabelText('Type DELETE to confirm')
    await userEvent.type(box, 'delete')
    expect(btn).toBeDisabled()
    await userEvent.clear(box)
    await userEvent.type(box, 'DELETE')
    expect(btn).toBeEnabled()
    expect(onSubmit).not.toHaveBeenCalled()
    await userEvent.click(btn)
    await waitFor(() => expect(onSubmit).toHaveBeenCalledTimes(1))
  })
  it('Cancel never submits', async () => {
    const { onSubmit, onOpenChange } = setup()
    await userEvent.click(screen.getByRole('button', { name: 'Cancel' }))
    expect(onSubmit).not.toHaveBeenCalled()
    expect(onOpenChange).toHaveBeenCalledWith(false)
  })
  it('shows a safe message when the server refuses, and keeps the dialog open', async () => {
    const { onOpenChange, onDone } = setup({ typed: undefined, onSubmit: vi.fn().mockRejectedValue(new ApiRequestError(403, 'forbidden', 'raw server text SELECT * FROM x')) })
    await userEvent.click(screen.getByRole('button', { name: 'Delete account' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('You do not have permission for this action.')
    expect(screen.queryByText(/SELECT/)).toBeNull()
    expect(onOpenChange).not.toHaveBeenCalledWith(false)
    expect(onDone).not.toHaveBeenCalled()
  })
  it('an unexpected error never shows its text', async () => {
    setup({ typed: undefined, onSubmit: vi.fn().mockRejectedValue(new Error('connect ECONNREFUSED 10.0.0.5')) })
    await userEvent.click(screen.getByRole('button', { name: 'Delete account' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('Something went wrong')
    expect(screen.queryByText(/ECONNREFUSED/)).toBeNull()
  })
  it('closes and reports done after success', async () => {
    const { onOpenChange, onDone } = setup({ typed: undefined })
    await userEvent.click(screen.getByRole('button', { name: 'Delete account' }))
    await waitFor(() => expect(onDone).toHaveBeenCalled())
    expect(onOpenChange).toHaveBeenCalledWith(false)
  })
})
