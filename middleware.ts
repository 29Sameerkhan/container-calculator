import { NextRequest, NextResponse } from 'next/server';
import { getToken } from 'next-auth/jwt';

// Everything needs a session except these: shared plan links, and sign-in itself.
// Anything added to the app later is protected by default.
function isPublic(pathname: string): boolean {
  return pathname.startsWith('/plan/') || pathname.startsWith('/api/auth/');
}

// A token that can't be read (including when NEXTAUTH_SECRET is unset) counts as signed out
async function hasSession(req: NextRequest): Promise<boolean> {
  try {
    return !!(await getToken({ req, secret: process.env.NEXTAUTH_SECRET }));
  } catch {
    return false;
  }
}

export async function middleware(req: NextRequest) {
  const { pathname } = req.nextUrl;
  if (isPublic(pathname)) return NextResponse.next();

  const signedIn = await hasSession(req);
  if (pathname === '/login') {
    return signedIn ? NextResponse.redirect(new URL('/dashboard', req.url)) : NextResponse.next();
  }
  if (signedIn) return NextResponse.next();

  // The app's own fetch calls expect JSON, not the login page
  if (pathname.startsWith('/api/')) {
    return NextResponse.json({ error: 'Please sign in again' }, { status: 401 });
  }
  return NextResponse.redirect(new URL('/login', req.url));
}

export const config = {
  // Built assets have to load on the login and public plan pages too
  matcher: '/((?!_next/static|_next/image|favicon.ico).*)',
};
