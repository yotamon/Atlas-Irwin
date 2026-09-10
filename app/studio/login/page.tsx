import { EnsemblisMark } from "@/components/ensemblis-logo";
import { ENSEMBLIS_PRODUCT } from "@/lib/ensemblis-product";
import { signInStudio } from "../login-actions";
import { studioReturnPath } from "@/lib/auth/studio-return-path";

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string; next?: string }>;
}) {
  const params = await searchParams;

  return (
    <main className="studio-auth">
      <section>
        <div className="ensemblis-auth-brand">
          <span className="ensemblis-auth-symbol" aria-hidden><EnsemblisMark /></span>
          <div>
            <strong>{ENSEMBLIS_PRODUCT.name}</strong>
            <small>{ENSEMBLIS_PRODUCT.descriptor}</small>
          </div>
        </div>
        <h1>{ENSEMBLIS_PRODUCT.promise}</h1>
        <p>{ENSEMBLIS_PRODUCT.positioning}</p>
        <form action={signInStudio}>
          <input type="hidden" name="next" value={studioReturnPath(params.next)} />
          <label>
            Email
            <input
              name="email"
              type="email"
              autoComplete="username"
              placeholder="Ensemblis account email"
              required
            />
          </label>
          <label>
            Password
            <input
              name="password"
              type="password"
              autoComplete="current-password"
              required
              placeholder="Password"
            />
          </label>
          <button className="button primary">Sign in</button>
        </form>
        {params.error && <p className="form-error">{params.error}</p>}
        <small>Secure access to your Ensemblis workspace.</small>
      </section>
    </main>
  );
}
