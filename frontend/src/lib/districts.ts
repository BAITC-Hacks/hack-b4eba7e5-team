// Объединённая область карты использует исходный ID и показатели Алматы из ТЗ.
export const combinedDistrictName = 'Алматы и Сарайшык'

export function districtDisplayName(id: string, name: string): string {
  return id === 'almaty' ? combinedDistrictName : name
}
