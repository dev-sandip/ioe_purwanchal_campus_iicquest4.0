export const paginatedResponse = <T>(
  items: T[],
  totalItems: number,
  page: number,
  limit: number,
) => ({
  items,
  meta: {
    totalItems,
    itemCount: items.length,
    itemsPerPage: limit,
    totalPages: Math.ceil(totalItems / limit),
    currentPage: page,
  },
});
