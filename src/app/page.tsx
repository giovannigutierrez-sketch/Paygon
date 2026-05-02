// PROTOTYPE — index redirect. The cockpit lives at /cockpit.

import { redirect } from 'next/navigation';

export default function HomePage(): never {
  redirect('/cockpit');
}
