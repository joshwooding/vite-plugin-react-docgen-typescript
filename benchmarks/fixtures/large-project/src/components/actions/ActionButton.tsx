import type { ActionDefinition, TestIdentifiable } from "@shared/index";

export interface ActionButtonProps<TPayload> extends TestIdentifiable {
  /** Action payload and analytics metadata used for event fan-out. */
  action: ActionDefinition<TPayload>;
  /** Visual treatment used by dense toolbars and cards. */
  emphasis?: "primary" | "secondary";
  /** Prevents interaction during pending mutations. */
  disabled?: boolean;
}

/** Action trigger used across feature entry points. */
export const ActionButton = <TPayload,>({
  action,
  emphasis = "secondary",
  disabled = false,
  testId,
}: ActionButtonProps<TPayload>) => {
  return (
    <button
      data-emphasis={emphasis}
      data-event={action.analytics.eventName}
      data-testid={testId}
      disabled={disabled}
      type="button"
    >
      {action.label}
    </button>
  );
};
