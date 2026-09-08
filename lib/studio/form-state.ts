export type ActionFieldErrors = Record<string, string[] | undefined>;

export type ActionFormState = {
  errors: ActionFieldErrors;
  message?: string;
};

export const EMPTY_ACTION_FORM_STATE: ActionFormState = { errors: {} };

export function firstActionFieldError(state: ActionFormState, name: string) {
  return state.errors[name]?.[0];
}
