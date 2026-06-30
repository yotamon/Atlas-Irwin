import Image from "next/image";
import Link from "next/link";
import { hasSupabaseEnv } from "@/lib/supabase/config";

export default function StudioSetupPage() {
  if (hasSupabaseEnv()) {
    return (
      <main className="studio-auth">
        <section>
          <Image
            src="/atlas-irwin-logo-sign.svg"
            alt="Atlas Irwin"
            width={48}
            height={48}
          />
          <h1>Studio is configured</h1>
          <p>Supabase environment variables are loaded. Continue into Studio.</p>
          <Link className="button primary" href="/studio">
            Open Studio
          </Link>
        </section>
      </main>
    );
  }

  return (
    <main className="studio-auth">
      <section>
        <Image
          src="/atlas-irwin-logo-sign.svg"
          alt="Atlas Irwin"
          width={48}
          height={48}
        />
        <h1>Configure Studio</h1>
        <p>
          Studio requires Supabase. Create a local env file before opening protected
          routes.
        </p>
        <ol>
          <li>Copy <code>.env.example</code> to <code>.env.local</code></li>
          <li>
            Set <code>NEXT_PUBLIC_SUPABASE_URL</code> and{" "}
            <code>NEXT_PUBLIC_SUPABASE_ANON_KEY</code> from your Supabase project
          </li>
          <li>
            Set <code>SUPABASE_SERVICE_ROLE_KEY</code> for local Studio bootstrap and
            catalog import
          </li>
          <li>
            Set <code>STUDIO_ADMIN_EMAILS</code> and <code>STUDIO_PASSWORD</code>
          </li>
          <li>Restart <code>npm run dev</code></li>
        </ol>
        <p>
          Apply migrations in <code>supabase/migrations/</code>, then run{" "}
          <code>npm run studio:import</code> to migrate legacy releases.
        </p>
        <Link className="button" href="/">
          Back to site
        </Link>
      </section>
    </main>
  );
}
