import Link from "next/link";
export default function NotFound() {
  return (
    <div className="empty-state">
      <h1>Record not found</h1>
      <p>It may have been removed or does not belong to this Studio.</p>
      <Link className="button" href="/studio">
        Back to dashboard
      </Link>
    </div>
  );
}
