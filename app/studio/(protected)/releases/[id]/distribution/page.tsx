import ReleaseDistributionPage, { metadata } from "./release-distribution-page";
import ReleaseDistributionLifecycle from "./release-distribution-lifecycle";

export { metadata };

export default async function DistributionRoute(props: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ notice?: string; error?: string }>;
}) {
  return <>
    <ReleaseDistributionPage {...props} />
    <ReleaseDistributionLifecycle params={props.params} />
  </>;
}
