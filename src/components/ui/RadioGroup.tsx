import * as React from "react"
import { cn } from "@/lib/utils"

interface RadioOption {
  value: string
  label: string
  description?: string
  icon?: React.ReactNode
}

export interface RadioGroupProps {
  options: RadioOption[]
  value: string
  onChange: (value: string) => void
  className?: string
  cols?: 1 | 2 | 3 | 4
}

export function RadioGroup({ 
  options, 
  value, 
  onChange, 
  className,
  cols = 2 
}: RadioGroupProps) {
  return (
    <div className={cn(
      "grid gap-3",
      cols === 1 && "grid-cols-1",
      cols === 2 && "grid-cols-2",
      cols === 3 && "grid-cols-3",
      cols === 4 && "grid-cols-4",
      className
    )}>
      {options.map((option) => (
        <button
          key={option.value}
          type="button"
          onClick={() => onChange(option.value)}
          className={cn(
            "p-4 rounded-card border-2 transition-all duration-200 text-left",
            value === option.value
              ? "border-primary bg-primary/10 text-primary"
              : "border-border hover:border-muted-foreground text-foreground"
          )}
        >
          {option.icon && (
            <div className="text-2xl mb-2">{option.icon}</div>
          )}
          <div className="font-medium">{option.label}</div>
          {option.description && (
            <div className="text-label text-muted-foreground mt-1">
              {option.description}
            </div>
          )}
        </button>
      ))}
    </div>
  )
}