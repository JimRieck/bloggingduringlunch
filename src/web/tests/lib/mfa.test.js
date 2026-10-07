import { describe, expect, it } from 'vitest'
import { formatSecret, mfaStep } from '../../src/lib/mfa.js'

// A token is three base64url segments; mfaStep only reads the middle
// (payload) one, so the header and signature can be anything here.
function tokenWith(claims) {
  const payload = Buffer.from(JSON.stringify(claims)).toString('base64url')
  return `header.${payload}.signature`
}

function session(aal, factors = []) {
  return { access_token: tokenWith({ sub: 'user-1', aal }), user: { id: 'user-1', factors } }
}

const verifiedTotp = { id: 'f1', factor_type: 'totp', status: 'verified' }

describe('mfaStep', () => {
  it('is null when logged out', () => {
    expect(mfaStep(null)).toBeNull()
  })

  it('is null once the code has been entered (aal2)', () => {
    expect(mfaStep(session('aal2', [verifiedTotp]))).toBeNull()
  })

  it('asks for setup when the password is in but no authenticator exists yet', () => {
    expect(mfaStep(session('aal1'))).toBe('setup')
  })

  it('still asks for setup when the only authenticator was never confirmed', () => {
    expect(mfaStep(session('aal1', [{ id: 'f1', factor_type: 'totp', status: 'unverified' }]))).toBe('setup')
  })

  it('asks for the code when the password is in and an authenticator exists', () => {
    expect(mfaStep(session('aal1', [verifiedTotp]))).toBe('challenge')
  })

  it('treats an unreadable token as not verified, never as fully logged in', () => {
    expect(mfaStep({ access_token: 'garbage', user: { factors: [verifiedTotp] } })).toBe('challenge')
  })
})

describe('formatSecret', () => {
  it('groups the key in fours for typing by hand', () => {
    expect(formatSecret('JBSWY3DPEHPK3PXPAB')).toBe('JBSW Y3DP EHPK 3PXP AB')
  })

  it('handles a missing key', () => {
    expect(formatSecret(undefined)).toBe('')
  })
})
