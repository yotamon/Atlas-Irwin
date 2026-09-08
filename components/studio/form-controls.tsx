"use client";

import { Select as BaseSelect } from "@base-ui/react/select";
import { Switch as BaseSwitch } from "@base-ui/react/switch";
import type { ReactNode } from "react";

export type SelectOption = {
  value: string;
  label: string;
  disabled?: boolean;
};

export function SelectField({
  label,
  name,
  options,
  defaultValue,
  value,
  onValueChange,
  placeholder = "Choose an option",
  hint,
  error,
  required = false,
  disabled = false,
  wide = false,
}: {
  label: ReactNode;
  name: string;
  options: SelectOption[];
  defaultValue?: string;
  value?: string;
  onValueChange?: (value: string) => void;
  placeholder?: string;
  hint?: ReactNode;
  error?: ReactNode;
  required?: boolean;
  disabled?: boolean;
  wide?: boolean;
}) {
  return (
    <div className={`field ensemblis-select-field${wide ? " wide" : ""}`} data-invalid={Boolean(error) || undefined}>
      <BaseSelect.Root
        items={options}
        name={name}
        required={required}
        disabled={disabled}
        {...(value !== undefined ? { value } : {})}
        {...(defaultValue !== undefined ? { defaultValue } : {})}
        onValueChange={(nextValue) => {
          if (typeof nextValue === "string") onValueChange?.(nextValue);
        }}
      >
        <BaseSelect.Label className="ensemblis-field-label">
          {label}{required ? <small aria-hidden> · required</small> : null}
        </BaseSelect.Label>
        <BaseSelect.Trigger className="ensemblis-select-trigger" aria-invalid={Boolean(error) || undefined}>
          <BaseSelect.Value className="ensemblis-select-value" placeholder={placeholder} />
          <BaseSelect.Icon className="ensemblis-select-icon" aria-hidden>⌄</BaseSelect.Icon>
        </BaseSelect.Trigger>
        <BaseSelect.Portal>
          <BaseSelect.Positioner className="ensemblis-select-positioner" sideOffset={6}>
            <BaseSelect.Popup className="ensemblis-select-popup">
              <BaseSelect.List className="ensemblis-select-list">
                {options.map((option) => (
                  <BaseSelect.Item
                    className="ensemblis-select-item"
                    key={option.value}
                    value={option.value}
                    disabled={option.disabled}
                  >
                    <BaseSelect.ItemText>{option.label}</BaseSelect.ItemText>
                    <BaseSelect.ItemIndicator className="ensemblis-select-indicator" aria-hidden>✓</BaseSelect.ItemIndicator>
                  </BaseSelect.Item>
                ))}
              </BaseSelect.List>
            </BaseSelect.Popup>
          </BaseSelect.Positioner>
        </BaseSelect.Portal>
      </BaseSelect.Root>
      {hint ? <small className="field-hint">{hint}</small> : null}
      {error ? <small className="field-error" role="alert">{error}</small> : null}
    </div>
  );
}

export function SwitchField({
  label,
  description,
  name,
  defaultChecked,
  checked,
  onCheckedChange,
  value = "on",
  disabled = false,
}: {
  label: ReactNode;
  description?: ReactNode;
  name: string;
  defaultChecked?: boolean;
  checked?: boolean;
  onCheckedChange?: (checked: boolean) => void;
  value?: string;
  disabled?: boolean;
}) {
  return (
    <label className="ensemblis-switch-field">
      <span className="ensemblis-switch-copy">
        <strong>{label}</strong>
        {description ? <small>{description}</small> : null}
      </span>
      <BaseSwitch.Root
        className="ensemblis-switch"
        name={name}
        value={value}
        disabled={disabled}
        {...(checked !== undefined ? { checked } : {})}
        {...(defaultChecked !== undefined ? { defaultChecked } : {})}
        onCheckedChange={onCheckedChange}
      >
        <BaseSwitch.Thumb className="ensemblis-switch-thumb" />
      </BaseSwitch.Root>
    </label>
  );
}
