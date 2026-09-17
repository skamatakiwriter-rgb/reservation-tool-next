import type { CategoryId } from './types'

export const categories: ReadonlyArray<{
  id: CategoryId
  name: string
  requiresAddress: boolean
}> = [
  { id: 'keikoukan', name: '蛍光管持込', requiresAddress: false },
  { id: 'kagu', name: '家具家財撤去', requiresAddress: true },
  { id: 'binkan', name: 'ビン缶回収', requiresAddress: true },
]

export function isCategoryId(value: unknown): value is CategoryId {
  return categories.some((category) => category.id === value)
}

export function categoryRequiresAddress(categoryId: CategoryId): boolean {
  return categoryId !== 'keikoukan'
}
