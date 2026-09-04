import { EnsemblisMark } from "@/components/ensemblis-logo";
import { adminEmails } from "@/lib/auth/studio";
import { ENSEMBLIS_PRODUCT } from "@/lib/ensemblis-product";
import { signInStudio } from "../login-actions";

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string }>;
}) {
  const params = await searchParams;
  const admins = adminEmails();
  const defaultEmail = admins.length === 1 ? admins[0] : undefined;

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
          <label>
            Email
            <input
              name="email"
              type="email"
              autoComplete="username"
              defaultValue={defaultEmail}
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
