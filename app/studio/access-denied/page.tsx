import { ENSEMBLIS_PRODUCT } from "@/lib/ensemblis-product";
import { signOut } from "../actions";

export default function AccessDenied() {
  return (
    <main className="studio-auth">
      <section>
        <div className="ensemblis-auth-brand">
          <span className="ensemblis-auth-symbol" aria-hidden>E</span>
          <div>
            <strong>{ENSEMBLIS_PRODUCT.name}</strong>
            <small>{ENSEMBLIS_PRODUCT.descriptor}</small>
          </div>
        </div>
        <h1>Access denied</h1>
        <p>
          This account is signed in, but it does not have access to an approved Ensemblis workspace.
        </p>
        <form action={signOut}>
          <button className="button">Sign out</button>
        </form>
      </section>
    </main>
  );
}
