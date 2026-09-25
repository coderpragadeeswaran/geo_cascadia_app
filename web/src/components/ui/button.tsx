import * as React from 'react'
import { Slot } from '@radix-ui/react-slot'
import { cva, type VariantProps } from 'class-variance-authority'
import { cn } from '@/lib/utils'

const buttonVariants = cva(
  'inline-flex items-center justify-center gap-1.5 whitespace-nowrap rounded-[10px] text-[13px] font-medium transition-colors ' +
    'disabled:pointer-events-none disabled:opacity-40 [&_svg]:size-4 [&_svg]:shrink-0 cursor-pointer select-none',
  {
    variants: {
      variant: {
        ghost: 'text-fg/80 hover:bg-hover hover:text-fg',
        subtle: 'bg-hover text-fg hover:bg-[var(--glass-border)]',
        accent: 'bg-accent text-white hover:brightness-110 shadow-[0_6px_20px_-8px_var(--accent)]',
        outline: 'border border-glass-border text-fg hover:bg-hover',
      },
      size: { sm: 'h-7 px-2.5', md: 'h-8 px-3', icon: 'size-8', 'icon-sm': 'size-7' },
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
        className={cn(buttonVariants({ variant, size }), 'data-[active]:bg-accent-soft data-[active]:text-accent', className)}
        {...props}
      />
    )
  },
)
Button.displayName = 'Button'
