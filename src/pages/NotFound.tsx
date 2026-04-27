import { Link } from "react-router-dom";

export default function NotFound() {
  return (
    <div className="flex min-h-screen items-center justify-center bg-background p-4">
      <div className="text-center space-y-4">
        <h1 className="text-5xl font-bold">404</h1>
        <p className="text-muted-foreground">Diese Seite gibt es nicht.</p>
        <Link to="/" className="text-primary hover:underline text-sm">
          Zurück zum Dashboard
        </Link>
      </div>
    </div>
  );
}
