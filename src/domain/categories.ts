import type { CategoryId } from './types'

export const categories: ReadonlyArray<{
  id: CategoryId
  name: string
  requiresAddress: boolean
  requiresDispatch: boolean
}> = [
  { id: 'keikoukan', name: '蛍光管持込', requiresAddress: false, requiresDispatch: false },
  { id: 'kagu', name: '家具家財撤去', requiresAddress: true, requiresDispatch: true },
  { id: 'binkan', name: 'ビン缶回収', requiresAddress: true, requiresDispatch: true },
]

export function isCategoryId(value: unknown): value is CategoryId {
  return categories.some((category) => category.id === value)
}

export function categoryRequiresAddress(categoryId: CategoryId): boolean {
  return categories.find((category) => category.id === categoryId)?.requiresAddress ?? false
}

export function categoryRequiresDispatch(categoryId: CategoryId): boolean {
  return categories.find((category) => category.id === categoryId)?.requiresDispatch ?? false
}
