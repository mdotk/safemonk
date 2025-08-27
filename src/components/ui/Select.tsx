import * as React from "react"
import { ChevronDown } from 'lucide-react'
import { cn } from "@/lib/utils"

export interface SelectProps
  extends React.SelectHTMLAttributes<HTMLSelectElement> {}

const Select = React.forwardRef<HTMLSelectElement, SelectProps>(
  ({ className, children, ...props }, ref) => {
    return (
      <div className="relative">
        <select
          className={cn(
            "flex h-12 w-full rounded-sharp border border-input bg-input px-4 py-0 pr-10 text-body ring-offset-background placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:border-ring disabled:cursor-not-allowed disabled:opacity-50 transition-all duration-200 ease appearance-none cursor-pointer",
            className
          )}
          style={{
            // Force option colors for better browser compatibility
            colorScheme: 'dark',
            color: '#F5F5F7',
            backgroundColor: '#24252D',
            lineHeight: '48px'
          }}
          ref={ref}
          {...props}
        >
          {children}
        </select>
        <ChevronDown 
          className="absolute right-3 top-1/2 -translate-y-1/2 w-5 h-5 pointer-events-none z-10 select-arrow" 
          style={{ 
            color: '#F5F5F7',
            fill: '#F5F5F7',
            stroke: '#F5F5F7',
            opacity: 1,
            display: 'block',
            visibility: 'visible'
          }} 
        />
      </div>
    )
  }
)
Select.displayName = "Select"

export { Select }