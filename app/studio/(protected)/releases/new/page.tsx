import { PageHeader } from "@/components/studio/ui";
import { ReleaseForm } from "@/components/studio/release-form";

export default function NewRelease() {
  return (
    <div className="studio-v2-page v2-narrow-page">
      <PageHeader
        title="New release"
        description="Three essentials create the workspace. Atlas prepares the operational structure without spending money or publishing anything."
      />
      <ReleaseForm />
    </div>
  );
}
