import Image from "next/image";
import { adminEmails } from "@/lib/auth/studio";
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
        <Image
          src="/atlas-irwin-logo-sign.svg"
          alt="Atlas Irwin"
          width={48}
          height={48}
        />
        <h1>Release Engine</h1>
        <p>Private access to the Atlas Irwin release studio.</p>
        <form action={signInStudio}>
          <label>
            Email
            <input
              name="email"
              type="email"
              autoComplete="username"
              defaultValue={defaultEmail}
              placeholder="Studio administrator email"
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
              placeholder="Studio password"
            />
          </label>
          <button className="button primary">Sign in</button>
        </form>
        {params.error && <p className="form-error">{params.error}</p>}
        <small>Access is restricted to approved Studio administrators.</small>
      </section>
    </main>
  );
}
