/**
 * Root layout for the cockpit prototype.
 *
 * NOTE: This is prototype-level. No auth, no telemetry, no providers other
 * than what the Friday view itself needs. Real production wiring is
 * generalist-Claude work.
 */

import type { Metadata } from 'next';
import * as React from 'react';
import './globals.css';

export const metadata: Metadata = {
  title: 'Paygon Cockpit',
  description:
    'Run 30+ client payrolls on a Friday without losing your mind. Prototype.',
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}): React.JSX.Element {
  return (
    <html lang="en" className="h-full">
      <body className="h-full">{children}</body>
    </html>
  );
}
