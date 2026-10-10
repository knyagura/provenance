import type { ButtonHTMLAttributes, ReactNode } from 'react';

export type ButtonVariant = 'primary' | 'secondary' | 'quiet';

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  /** primary = the one terracotta action on a screen; secondary = outlined; quiet = underlined link style. */
  variant?: ButtonVariant;
  /** Stretch to the container's width (used for the main action on phones). */
  block?: boolean;
  icon?: ReactNode;
}

export function Button({ variant = 'secondary', block, icon, className, children, type = 'button', ...rest }: ButtonProps) {
  const cls = ['pv-btn', `pv-btn--${variant}`, block ? 'pv-btn--block' : '', className ?? ''].filter(Boolean).join(' ');
  return (
    <button type={type} className={cls} {...rest}>
      {icon}
      {children}
    </button>
  );
}
