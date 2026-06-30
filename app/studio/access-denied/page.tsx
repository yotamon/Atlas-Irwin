import { signOut } from "../actions";
export default function AccessDenied() {
  return (
    <main className="studio-auth">
      <section>
        <h1>Access denied</h1>
        <p>
          This account is authenticated but is not on the Studio admin
          allowlist.
        </p>
        <form action={signOut}>
          <button className="button">Sign out</button>
        </form>
      </section>
    </main>
  );
}
