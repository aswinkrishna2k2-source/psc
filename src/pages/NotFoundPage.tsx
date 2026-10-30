import { Compass } from 'lucide-react';
import { EmptyState, LinkButton } from '../components/ui.tsx';

export function NotFoundPage() {
  return (
    <main className="flex min-h-dvh items-center justify-center p-4">
      <EmptyState
        icon={<Compass className="size-6" />}
        title="This page does not exist"
        action={<LinkButton to="/">Go to Home</LinkButton>}
      >
        The link may be old or mistyped.
      </EmptyState>
    </main>
  );
}
