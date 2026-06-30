import { headers } from "next/headers";
import Image from "next/image";
import { signInWithMagicLink } from "../actions";
export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ sent?: string; error?: string }>;
}) {
  const params = await searchParams;
  const h = await headers();
  const origin = `${h.get("x-forwarded-proto") ?? "http"}://${h.get("x-forwarded-host") ?? h.get("host") ?? "localhost:3000"}`;
  return (
    <main className="studio-auth">
      <section>
        <Image
          src="/atlas-irwin-logo-sign.svg"
          alt="Atlas Irwin"
          width={48}
          height={48}
        />
        <h1>Release Engine</h1>
        <p>Private access to the Atlas Irwin release studio.</p>
        {params.sent ? (
          <div className="auth-message">Magic link sent. Check your inbox.</div>
        ) : (
          <form action={signInWithMagicLink}>
            <input type="hidden" name="origin" value={origin} />
            <label>
              Email address
              <input
                name="email"
                type="email"
                autoComplete="email"
                required
                placeholder="you@example.com"
              />
            </label>
            <button className="button primary">Send magic link</button>
          </form>
        )}
        {params.error && <p className="form-error">{params.error}</p>}
        <small>Access is restricted to approved Studio administrators.</small>
      </section>
    </main>
  );
}
