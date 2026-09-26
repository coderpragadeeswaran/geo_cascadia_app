import * as React from 'react'
import { Slot } from '@radix-ui/react-slot'
import { cva, type VariantProps } from 'class-variance-authority'
import { cn } from '@/lib/utils'

/** Night Survey buttons: quiet ink by default, sodium outline for the one primary action, solid sodium when committed. */
const buttonVariants = cva(
  'inline-flex items-center justify-center gap-1.5 whitespace-nowrap rounded-[var(--ns-r-control)] text-[15.5px] font-[520] transition-colors ' +
    'disabled:pointer-events-none disabled:opacity-40 [&_svg]:size-4 [&_svg]:shrink-0 cursor-pointer select-none',
  {
    variants: {
      variant: {
        ghost: 'text-ink2 hover:bg-line hover:text-ink',
        subtle: 'text-ink shadow-[inset_0_0_0_1px_var(--ns-line-strong)] hover:bg-line',
        accent: 'text-sodium shadow-[inset_0_0_0_1px_color-mix(in_srgb,var(--ns-sodium)_55%,transparent)] hover:bg-accent-soft',
        solid: 'bg-sodium text-bg0 hover:bg-sodium-glow',
        outline: 'text-ink shadow-[inset_0_0_0_1px_var(--ns-line-strong)] hover:bg-line',
      },
      size: { sm: 'h-7 px-2.5', md: 'h-[30px] px-3', icon: 'size-[30px]', 'icon-sm': 'size-7' },
    },
    defaultVariants: { variant: 'ghost', size: 'md' },
  },
)

export interface ButtonProps
  extends React.ButtonHTMLAttributes<HTMLButtonElement>,
    VariantProps<typeof buttonVariants> {
  asChild?: boolean
  active?: boolean
}

export const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(
  ({ className, variant, size, asChild, active, ...props }, ref) => {
    const Comp = asChild ? Slot : 'button'
    return (
      <Comp
        ref={ref}
        data-active={active || undefined}
        className={cn(buttonVariants({ variant, size }), 'data-[active]:bg-accent-soft data-[active]:text-sodium', className)}
        {...props}
      />
    )
  },
)
Button.displayName = 'Button'
