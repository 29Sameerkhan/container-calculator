'use client';

import { FormEvent, useState } from 'react';
import { signIn } from 'next-auth/react';

export default function LoginPage() {
  const [password, setPassword] = useState('');
  const [signingIn, setSigningIn] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setSigningIn(true);
    setError(null);
    try {
      const res = await signIn('credentials', { password, redirect: false });
      if (res?.ok) {
        window.location.assign('/dashboard');
        return;
      }
      setError(res?.status === 401 ? 'Incorrect password' : 'Could not sign in. Please try again.');
    } catch {
      setError('Could not sign in. Please try again.');
    }
    setSigningIn(false);
  }

  return (
    <main
      className="min-h-screen flex items-center justify-center px-4"
      style={{ background: 'linear-gradient(135deg, #f0f4ff 0%, #f8faff 100%)' }}
    >
      <div className="w-full max-w-sm bg-white rounded-2xl shadow-sm border border-blue-100 overflow-hidden">
        <div className="px-6 py-5" style={{ background: 'linear-gradient(90deg, #1E4D8C 0%, #1a3f74 100%)' }}>
          <h1 className="text-xl font-semibold text-white">SLEKA Industries</h1>
          <p className="text-sm text-blue-200 mt-0.5">Container Load Calculator</p>
        </div>
        <form onSubmit={handleSubmit} className="p-6 space-y-4">
          <label className="block text-sm font-medium text-gray-700">
            Team password
            <input
              type="password"
              autoFocus
              autoComplete="current-password"
              value={password}
              onChange={e => setPassword(e.target.value)}
              className="mt-1 w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
          </label>
          {error && (
            <p role="alert" className="text-sm text-red-600 bg-red-50 border border-red-200 rounded-lg px-3 py-2">{error}</p>
          )}
          <button
            type="submit"
            disabled={signingIn || !password}
            className="w-full text-white font-medium px-6 py-2.5 rounded-xl text-sm transition-opacity hover:opacity-90 disabled:opacity-60"
            style={{ background: 'linear-gradient(135deg, #1E4D8C 0%, #2563c4 100%)' }}
          >
            {signingIn ? 'Signing in…' : 'Sign in'}
          </button>
        </form>
      </div>
    </main>
  );
}
