import * as React from 'react'
import * as Menu from '@radix-ui/react-dropdown-menu'
import { cn } from '@/lib/utils'

export const DropdownMenu = Menu.Root
export const DropdownMenuTrigger = Menu.Trigger

export const DropdownMenuContent = React.forwardRef<
  React.ElementRef<typeof Menu.Content>,
  React.ComponentPropsWithoutRef<typeof Menu.Content>
>(({ className, sideOffset = 8, ...props }, ref) => (
  <Menu.Portal>
    <Menu.Content
      ref={ref}
      sideOffset={sideOffset}
      className={cn(
        'sheet z-50 min-w-56 p-1.5 text-ink',
        'data-[state=open]:animate-in data-[state=open]:fade-in-0 data-[state=open]:zoom-in-95',
        className,
      )}
      {...props}
    />
  </Menu.Portal>
))
DropdownMenuContent.displayName = 'DropdownMenuContent'

export const DropdownMenuItem = React.forwardRef<
  React.ElementRef<typeof Menu.Item>,
  React.ComponentPropsWithoutRef<typeof Menu.Item>
>(({ className, ...props }, ref) => (
  <Menu.Item
    ref={ref}
    className={cn(
      'flex cursor-pointer select-none items-center gap-2 rounded-[var(--ns-r-control)] px-2.5 py-2 text-[15.5px] outline-none',
      'data-[highlighted]:bg-accent-soft data-[disabled]:opacity-40',
      className,
    )}
    {...props}
  />
))
DropdownMenuItem.displayName = 'DropdownMenuItem'

export const DropdownMenuLabel = ({ className, ...p }: React.HTMLAttributes<HTMLDivElement>) => (
  <div className={cn('eyebrow px-2.5 pb-1 pt-1.5', className)} {...p} />
)
