"use client";

import { confirmArtistIdentityAction } from "@/app/studio/onboarding/actions";
import { saveArtistOperatingProfileAction } from "@/app/studio/artist-operating-actions";
import { SelectField, SwitchField } from "@/components/studio/form-controls";
import { Field, Submit } from "@/components/studio/ui";
import { GOAL_LABELS, MARKETING_INVOLVEMENT_LABELS } from "@/lib/artist-operating/domain";

const PROJECT_TYPE_OPTIONS = [
  { value: "human", label: "Human artist" },
  { value: "ai_assisted", label: "Human artist using AI tools" },
  { value: "hybrid", label: "Hybrid music project" },
  { value: "virtual_persona", label: "Virtual / AI persona" },
];
const VISIBILITY_OPTIONS = [
  { value: "face_forward", label: "Face-forward" },
  { value: "selective", label: "Sometimes" },
  { value: "music_first", label: "Mostly music and visuals" },
  { value: "anonymous", label: "Anonymous" },
];
const GOAL_OPTIONS = Object.entries(GOAL_LABELS).map(([value, label]) => ({ value, label }));
const INVOLVEMENT_OPTIONS = Object.entries(MARKETING_INVOLVEMENT_LABELS).map(([value, label]) => ({ value, label }));

export function OnboardingIdentityForm({
  artistId,
  artistName,
}: {
  artistId: string;
  artistName: string;
}) {
  return (
    <form action={confirmArtistIdentityAction} className="ensemblis-onboarding-form studio-form">
      <input type="hidden" name="artist_id" value={artistId} />
      <Field label="Artist name" required>
        <input
          autoFocus
          required
          name="artist_name"
          defaultValue={artistName === "Artist" ? "" : artistName}
          maxLength={120}
        />
      </Field>
      <SelectField
        label="Project type"
        name="project_type"
        options={PROJECT_TYPE_OPTIONS}
        defaultValue="human"
      />
      <Submit>Use this artist</Submit>
    </form>
  );
}

export function OnboardingOperatingForm({
  currency,
  primaryGoal,
  marketingInvolvement,
  visibilityMode,
  visualsAllowed,
  monthlyBudget,
}: {
  currency: string;
  primaryGoal: string;
  marketingInvolvement: string;
  visibilityMode: string;
  visualsAllowed: boolean;
  monthlyBudget: number;
}) {
  return (
    <form action={saveArtistOperatingProfileAction} className="ensemblis-onboarding-form studio-form">
      <input type="hidden" name="currency" value={currency} />
      <SelectField label="Main goal" name="primary_goal" options={GOAL_OPTIONS} defaultValue={primaryGoal} />
      <SelectField
        label="How involved do you want to be in marketing?"
        name="marketing_involvement"
        options={INVOLVEMENT_OPTIONS}
        defaultValue={marketingInvolvement}
      />
      <SelectField label="How visible do you want to be?" name="visibility_mode" options={VISIBILITY_OPTIONS} defaultValue={visibilityMode} />
      <input type="hidden" name="ai_visuals_allowed_control" value="1" />
      <SwitchField
        label="Generative visuals"
        description="Can Ensemblis generate visuals when source media is not enough?"
        name="ai_visuals_allowed"
        defaultChecked={visualsAllowed}
      />
      <Field label="Monthly growth budget">
        <input type="number" name="monthly_budget" min="0" step="1" defaultValue={monthlyBudget} />
      </Field>
      <Submit>Use these preferences</Submit>
    </form>
  );
}
