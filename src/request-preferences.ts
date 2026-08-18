export const PAGE_SIZE_CHOICES = [20, 40, 80, 100] as const
export type PageSizeChoice = typeof PAGE_SIZE_CHOICES[number]
export const DENSITY_CHOICES = ['compact', 'regular', 'relaxed'] as const
export type DensityChoice = typeof DENSITY_CHOICES[number]

export function resolvedPageSize(request: Request): PageSizeChoice {
  const context = requestContext()
  if (context) return context.pageSize
  const value = Number(request.headers.get('x-textlog-page-size'))
  return PAGE_SIZE_CHOICES.includes(value as PageSizeChoice) ? value as PageSizeChoice : PAGE_SIZE
}

export function resolvedDensity(request: Request): DensityChoice {
  const context = requestContext()
  if (context) return context.density
  const value = request.headers.get('x-textlog-density')
  return DENSITY_CHOICES.includes(value as DensityChoice) ? value as DensityChoice : 'regular'
}
import { requestContext } from './request-context'
import { PAGE_SIZE } from './pagination'
