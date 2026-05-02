// PROTOTYPE — placeholder for the per-client detail route.
//
// Not designed yet. Exists so that the Friday view's row links resolve to a
// real URL (instead of 404'ing) when a processor middle-clicks "open in new
// tab". The actual content is the subject of a future round.

import * as React from 'react';

export default function ClientDetailPlaceholder({
  params,
}: {
  params: { clientHandle: string };
}): React.JSX.Element {
  return (
    <div className="mx-auto max-w-2xl px-6 py-12">
      <a
        href="/cockpit"
        className="text-xs text-blue-600 hover:underline dark:text-blue-400"
      >
        ← Back to cockpit
      </a>
      <h1 className="mt-4 text-xl font-semibold">Client detail (stub)</h1>
      <p className="mt-2 text-sm text-ink-muted dark:text-gray-400">
        Handle: <code className="font-mono">{params.clientHandle}</code>
      </p>
      <p className="mt-4 text-sm text-ink dark:text-gray-200">
        This route exists so the Friday cockpit&apos;s row links resolve. The
        real client detail view (pay-period drill-down, exception list, calc
        explainer, approval flow) is the next design round.
      </p>
    </div>
  );
}
