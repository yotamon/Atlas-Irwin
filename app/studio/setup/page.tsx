import Link from "next/link";
import { EnsemblisMark } from "@/components/ensemblis-logo";
import { ENSEMBLIS_PRODUCT } from "@/lib/ensemblis-product";
import { hasSupabaseEnv } from "@/lib/supabase/config";

function SetupBrand() {
  return (
    <div className="ensemblis-auth-brand">
      <span className="ensemblis-auth-symbol" aria-hidden><EnsemblisMark /></span>
      <div>
        <strong>{ENSEMBLIS_PRODUCT.name}</strong>
        <small>{ENSEMBLIS_PRODUCT.descriptor}</small>
      </div>
    </div>
  );
}

export default function StudioSetupPage() {
  if (hasSupabaseEnv()) {
    return (
      <main className="studio-auth">
        <section>
          <SetupBrand />
          <h1>Ensemblis is configured</h1>
          <p>Supabase is connected and the workspace can be opened normally.</p>
          <Link className="button primary" href="/studio">
            Open Ensemblis
          </Link>
        </section>
      </main>
    );
  }

  return (
    <main className="studio-auth">
      <section>
        <SetupBrand />
        <h1>Configure Ensemblis</h1>
        <p>
          Ensemblis requires Supabase for authentication, workspace data and durable
          artist state. Configure the local environment before opening protected
          routes.
        </p>
        <ol>
          <li>Copy <code>.env.example</code> to <code>.env.local</code></li>
          <li>
            Set <code>NEXT_PUBLIC_SUPABASE_URL</code> and{" "}
            <code>NEXT_PUBLIC_SUPABASE_ANON_KEY</code> from your Supabase project
          </li>
          <li>
            Set <code>SUPABASE_SERVICE_ROLE_KEY</code> for local bootstrap and catalog
            import
          </li>
          <li>
            Configure <code>STUDIO_ADMIN_EMAILS</code> and <code>STUDIO_PASSWORD</code>{" "}
            when using the legacy local administrator bootstrap
          </li>
          <li>Restart <code>npm run dev</code></li>
        </ol>
        <p>
          Apply migrations in <code>supabase/migrations/</code>, then run{" "}
          <code>npm run studio:import</code> only when migrating legacy release data.
        </p>
        <Link className="button" href="/">
          Back to artist site
        </Link>
      </section>
    </main>
  );
}
