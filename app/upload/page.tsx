import { headers } from 'next/headers';
import { redirect } from 'next/navigation';
import { hasSession } from '../../lib/session';
import { UploadForm } from './upload-form';

export const dynamic = 'force-dynamic';
export default async function UploadPage() {
  const requestHeaders = await headers();
  if (!hasSession(new Request('http://localhost/upload', { headers: { cookie: requestHeaders.get('cookie') ?? '' } }))) redirect('/');
  return <main className="studio dashboard"><a className="nav-link" href="/">Wróć do czatu</a><h1>Baza wiedzy</h1><UploadForm /></main>;
}
