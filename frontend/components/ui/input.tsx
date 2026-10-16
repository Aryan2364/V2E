import * as React from "react"
import { Input as InputPrimitive } from "@base-ui/react/input"

import { cn } from "@/lib/utils"

/**
 * Sections 6.2, 6.4 and 17.
 * Height is fixed at 36px so an input and a button line up on the same
 * row. Width comes from the column it sits in (section 17), capped at
 * 480px because a longer single line is uncomfortable to read back.
 * Validation colours the border danger; the message sits below the
 * field, never in a toast (section 7.1).
 */
function Input({ className, type, ...props }: React.ComponentProps<"input">) {
  return (
    <InputPrimitive
      type={type}
      data-slot="input"
      className={cn(
        "h-control w-full max-w-field-max min-w-0 rounded-lg border border-border bg-surface px-3 text-body text-text-primary transition-colors duration-(--duration-fast)",
        "placeholder:text-text-muted",
        "outline-none focus-visible:border-primary-ring focus-visible:outline-2 focus-visible:[outline-style:solid] focus-visible:outline-offset-0 focus-visible:outline-primary-ring",
        /*
         * Section 6.4: hover changes the background, pressed changes it
         * further. This control had NEITHER — only resting, disabled and
         * focus. Worse, globals.css forced a hover appearance for it in
         * the kitchen sink's state matrix, so the matrix displayed a
         * SECTION 6.4: A TEXT-ENTRY CONTROL IS NOT PRESSED, IT IS
         * FOCUSED. It carries no hover fill and no pressed fill - only
         * the border moves on hover, and focus is carried by the
         * border and the primary-ring.
         *
         * This field once had both fills. They were added to satisfy
         * `state-matrix-check`, which had correctly reported that it
         * declared no states - and the wrong half was fixed. The
         * background of a text field is carrying text the user is
         * reading back, and a pointer left over the field after a
         * click holds `:hover` for as long as they type. A hover fill
         * here is not a brief highlight, it is how the field looks in
         * use.
         *
         * `enabled:` so a disabled field does not light up under the
         * pointer.
         */
        "enabled:hover:border-border-strong",
        "disabled:cursor-default disabled:border-border-light disabled:bg-surface-sunken disabled:text-text-muted",
        "aria-invalid:border-danger aria-invalid:focus-visible:outline-danger",
        /*
         * The file button sits INSIDE the field, so it takes the in-field
         * height (6.2's exception, 41.9 rule 2): 32px on desktop as
         * before, 36px on phone. --h-control-sm is the small button's
         * height, 44px on phone - as tall as the field itself.
         */
        "file:mr-3 file:h-icon-in-field file:border-0 file:bg-transparent file:text-body file:font-medium file:text-text-primary",
        className
      )}
      {...props}
    />
  )
}

export { Input }

/**
 * Legacy adapter (v2e kit-alignment P3): the pre-kit Input bundled a label,
 * inline error/helper text and a password show/hide toggle around the bare
 * field. The kit's input.tsx is the bare field only (label.tsx and
 * inline-field-error.tsx are separate, composed per-form); this adapter
 * recomposes them behind the old default-export API so call sites only
 * need their import path updated. New forms should compose Input + Label +
 * InlineFieldError (or password-input.tsx for password fields) directly.
 * Tracked in components/ui/ADAPTERS.md.
 */
import * as React2 from "react"
import { Eye, EyeOff } from "lucide-react"

interface LegacyInputProps extends Omit<React2.InputHTMLAttributes<HTMLInputElement>, "type"> {
  label?: string
  error?: string
  helperText?: string
  type?: "text" | "email" | "password" | "number" | "date"
}

export default function LegacyInput({
  label,
  error,
  helperText,
  type = "text",
  required,
  className = "",
  name,
  id,
  ...rest
}: LegacyInputProps) {
  const [showPassword, setShowPassword] = React2.useState(false)
  const isPassword = type === "password"
  const resolvedType = isPassword ? (showPassword ? "text" : "password") : type
  const inputId = id ?? name

  return (
    <div className="flex flex-col gap-1">
      {label && (
        <label htmlFor={inputId} className="text-label text-text-secondary">
          {label}
          {required && (
            <span className="ml-0.5 text-danger" aria-hidden="true">
              *
            </span>
          )}
        </label>
      )}
      <div className="relative">
        <Input
          id={inputId}
          name={name}
          type={resolvedType}
          required={required}
          aria-invalid={!!error}
          className={isPassword ? `pr-10 ${className}` : className}
          {...rest}
        />
        {isPassword && (
          <button
            type="button"
            onClick={() => setShowPassword((prev) => !prev)}
            className="absolute right-3 top-1/2 -translate-y-1/2 text-text-muted hover:text-text-secondary transition-colors duration-150 focus:outline-hidden"
            aria-label={showPassword ? "Hide password" : "Show password"}
            tabIndex={-1}
          >
            {showPassword ? <EyeOff size={16} aria-hidden="true" /> : <Eye size={16} aria-hidden="true" />}
          </button>
        )}
      </div>
      {error && (
        <p className="text-meta text-danger" role="alert">
          {error}
        </p>
      )}
      {!error && helperText && <p className="text-meta text-text-muted">{helperText}</p>}
    </div>
  )
}
