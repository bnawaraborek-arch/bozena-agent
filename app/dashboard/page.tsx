import { headers } from 'next/headers';
import { redirect } from 'next/navigation';
import { hasSession } from '../../lib/session';
import { Dashboard } from './dashboard';

export const dynamic = 'force-dynamic';
export default async function DashboardPage() {
  const requestHeaders = await headers();
  if (!hasSession(new Request('http://localhost/dashboard', { headers: { cookie: requestHeaders.get('cookie') ?? '' } }))) redirect('/');
  return <Dashboard />;
}
