import { createHash, timingSafeEqual } from 'crypto';
import NextAuth, { type NextAuthOptions } from 'next-auth';
import CredentialsProvider from 'next-auth/providers/credentials';

function sha256(value: string): Buffer {
  return createHash('sha256').update(value).digest();
}

// Nobody can sign in while TEAM_PASSWORD is unset: a missing setting must not
// let an empty password through
function isTeamPassword(password: string | undefined): boolean {
  const teamPassword = process.env.TEAM_PASSWORD;
  if (!teamPassword || !password) return false;
  return timingSafeEqual(sha256(password), sha256(teamPassword));
}

const authOptions: NextAuthOptions = {
  session: { strategy: 'jwt' },
  pages: { signIn: '/login', error: '/login' },
  providers: [
    CredentialsProvider({
      name: 'Team password',
      credentials: { password: { label: 'Password', type: 'password' } },
      authorize(credentials) {
        return isTeamPassword(credentials?.password) ? { id: '1', name: 'SLEKA Team' } : null;
      },
    }),
  ],
};

const handler = NextAuth(authOptions);

export { handler as GET, handler as POST };
