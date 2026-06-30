import { PageHeader } from "@/components/studio/ui";
import { ReleaseForm } from "@/components/studio/release-form";
export default function NewRelease() {
  return (
    <>
      <PageHeader
        title="New release"
        description="Create the internal release workspace. Nothing publishes automatically."
      />
      <ReleaseForm />
    </>
  );
}
