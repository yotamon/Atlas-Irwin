import ReleaseDistributionPage, { metadata } from "./release-distribution-page";
import ReleaseDistributionArtistView from "./release-distribution-artist-view";
import ReleaseDistributionLifecycle from "./release-distribution-lifecycle";
import ReleaseDistributionTerritories from "./release-distribution-territories";

export { metadata };

export default async function DistributionRoute(props: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ notice?: string; error?: string }>;
}) {
  return <>
    <ReleaseDistributionArtistView {...props} />
    <ReleaseDistributionTerritories params={props.params} />
    <ReleaseDistributionLifecycle params={props.params} />
    <details className="distribution-page distribution-section distribution-advanced-tools">
      <summary><strong>Advanced provider tools</strong><span>Preflight diagnostics, package synchronization, store-level findings and reconciliation</span></summary>
      <div className="distribution-advanced-tools-body"><ReleaseDistributionPage {...props} /></div>
    </details>
  </>;
}