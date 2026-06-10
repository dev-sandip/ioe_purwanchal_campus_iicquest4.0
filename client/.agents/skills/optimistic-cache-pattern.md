---
name: optimistic-cache-pattern
description: Instant UI with background data resolution using React Query cache layers. Apply when building CRUD UIs, edit forms, detail views, or any flow where partial data is already available and full data needs fetching. Eliminates perceived latency by showing what you have immediately and resolving the rest in the background.
topics: [react-patterns, performance]
---

# Optimistic Cache Pattern (OCP)

**Technique:** Show-What-You-Have, Fetch-What-You-Need

The core principle: **never make the user wait for data you already have.** Open the UI instantly with cached/partial data, then resolve missing fields in the background via React Query's cache layers.

---

## The Problem

Traditional CRUD flows block the UI while fetching:

```
Click Edit → loading spinner → await GET /api/item/:id (2-5s) → form opens
```

The data needed to render the form is 90% available from the list view. Only sensitive/heavy fields (passwords, blobs, computed fields) require a dedicated fetch. Yet the entire UI waits.

---

## The Pattern

### Layer 1: Instant UI with Available Data

Open the UI immediately using data already in memory (list cache, parent component props, URL params):

```tsx
const handleEdit = useCallback(
  async (item: Item) => {
    // INSTANT: Open form with data from the list
    setEditingItem(item);
    setFormOpen(true);

    // BACKGROUND: Fetch full data (passwords, computed fields, etc.)
    const fullItem = await queryClient.fetchQuery({
      queryKey: QUERY_KEYS.ITEM(item.id),
      queryFn: () => itemService.get(item.id),
      staleTime: 2 * 60 * 1000, // Don't refetch if recently loaded
    });

    // Update form with complete data (missing fields fill in)
    setEditingItem(fullItem);
  },
  [queryClient],
);
```

### Layer 2: React Query Cache (staleTime)

`fetchQuery` checks the cache first. If data exists and isn't stale, **zero network requests**:

```
1st edit of Item A → fetches from API → cached
2nd edit of Item A → reads from cache → instant (0ms)
Edit Item A, save → mutation updates cache → next edit is instant
```

### Layer 3: Mutation Cache Sync

When mutations succeed, update the cache so future reads are instant:

```tsx
// After update mutation succeeds:
onSuccess: (updatedItem) => {
  // Update individual item cache
  queryClient.setQueryData(QUERY_KEYS.ITEM(updatedItem.id), updatedItem);

  // Update list cache (no refetch needed)
  queryClient.setQueriesData({ queryKey: QUERY_KEYS.ITEMS }, (old) => {
    if (!old) return old;
    return {
      ...old,
      data: old.data.map((item) =>
        item.id === updatedItem.id ? updatedItem : item,
      ),
    };
  });
};
```

**Do NOT combine `setQueriesData` with `invalidateQueries`** — the invalidation triggers a refetch that immediately overwrites your optimistic update.

---

## Implementation Checklist

### For Edit/Detail Flows

```tsx
// 1. Open UI instantly with partial data
setItem(partialData);
setOpen(true);

// 2. Fetch full data through React Query cache
const full = await queryClient.fetchQuery({
  queryKey: ["items", id],
  queryFn: () => api.get(id),
  staleTime: 2 * 60 * 1000,
});

// 3. Merge full data into UI
setItem(full);
```

### For Create Flows (Optimistic Insert)

```tsx
onSuccess: (newItem) => {
  // Insert into list cache immediately — no refetch
  queryClient.setQueriesData({ queryKey: ["items"] }, (old) => ({
    ...old,
    data: [newItem, ...old.data],
    pagination: { ...old.pagination, total: old.pagination.total + 1 },
  }));
};
```

### For Delete Flows (Optimistic Remove)

```tsx
onSuccess: (_, deletedId) => {
  // Remove from individual cache
  queryClient.removeQueries({ queryKey: ["items", deletedId] });

  // Remove from list cache immediately — no refetch
  queryClient.setQueriesData({ queryKey: ["items"] }, (old) => ({
    ...old,
    data: old.data.filter((item) => item.id !== deletedId),
    pagination: {
      ...old.pagination,
      total: Math.max(0, old.pagination.total - 1),
    },
  }));
};
```

### For Navigation Prefetch (Hover/Focus)

```tsx
// Prefetch on hover — data ready by the time user clicks
const handleMouseEnter = (id: string) => {
  queryClient.prefetchQuery({
    queryKey: ["items", id],
    queryFn: () => api.get(id),
    staleTime: 60 * 1000,
  });
};

<Link onMouseEnter={() => handleMouseEnter(item.id)} href={`/items/${item.id}`}>
  {item.name}
</Link>;
```

---

## Parallel Fetching (Waterfall Elimination)

### Problem: Sequential Dependencies

```
Auth check (5s) → Page renders → Data fetch (3s) = 8s total
```

### Solution: Parallel from Mount

```tsx
function Page() {
  // Both hooks fire on mount — run in parallel
  const { isLoading: authLoading } = useAuth(); // 5s
  const { data, isLoading: dataLoading } = useItems(); // 3s
  // Total: max(5s, 3s) = 5s instead of 8s

  if (authLoading || !isAuthenticated) return <Loader />;
  return <Content data={data} isLoading={dataLoading} />;
}
```

**Key rule:** Call ALL hooks unconditionally at the top of the component. Use early returns AFTER all hooks.

### Anti-Pattern: Provider Blocking

```tsx
// BAD: Provider blocks children from mounting
function AuthProvider({ children }) {
  const { isLoading } = useSession();
  if (isLoading) return <Loader />; // Children never mount, can't start fetching
  return <Context.Provider>{children}</Context.Provider>;
}

// GOOD: Provider always renders children
function AuthProvider({ children }) {
  const { isLoading } = useSession();
  // Always render — children mount immediately and start their own fetches
  return <Context.Provider value={{ isLoading }}>{children}</Context.Provider>;
}
```

---

## staleTime Strategy

| Data Type                                    | staleTime             | Rationale                                   |
| -------------------------------------------- | --------------------- | ------------------------------------------- |
| User session                                 | Cookie cache (server) | Never fetched client-side with cookie cache |
| Static config                                | 10-30 min             | Rarely changes                              |
| User's own data (connections, saved queries) | 2-5 min               | Changes on user action, not externally      |
| Shared/collaborative data                    | 30s-1 min             | Others may modify                           |
| Real-time data (notifications, status)       | 0-10s                 | Must stay current                           |

---

## Common Mistakes

### 1. Invalidate + Set (Double Update)

```tsx
// BAD: Invalidation triggers refetch that overwrites the optimistic set
onSuccess: (item) => {
  queryClient.invalidateQueries({ queryKey: ['items'] }); // Triggers refetch
  queryClient.setQueriesData({ queryKey: ['items'] }, ...); // Overwritten!
}

// GOOD: Pick one strategy
onSuccess: (item) => {
  queryClient.setQueriesData({ queryKey: ['items'] }, ...); // Optimistic
}
```

### 2. Raw Service Calls Bypassing Cache

```tsx
// BAD: Direct API call — no caching, no deduplication
const data = await itemService.get(id);

// GOOD: Through React Query — cached, deduplicated, retried
const data = await queryClient.fetchQuery({
  queryKey: ["items", id],
  queryFn: () => itemService.get(id),
  staleTime: 2 * 60 * 1000,
});
```

### 3. Blocking UI for Non-Critical Data

```tsx
// BAD: Wait for everything before opening
const full = await fetchFullItem(id); // Blocks 3s
setItem(full);
setOpen(true);

// GOOD: Open with what you have, fill in the rest
setItem(partial); // From list cache
setOpen(true); // Instant
const full = await fetchFullItem(id); // Background
setItem(full); // Password fills in
```

### 4. Conditional Hooks (Waterfall by Design)

```tsx
// BAD: Second fetch can't start until first resolves
const { data: auth } = useSession();
const { data: items } = useItems({ enabled: !!auth }); // Waits for auth

// GOOD: Both start immediately — auth check is in the UI, not the fetch
const { data: auth, isLoading: authLoading } = useSession();
const { data: items, isLoading: itemsLoading } = useItems(); // Starts now
// API returns 401 if not authed — React Query handles the error
```

---

## When to Apply This Pattern

- **Edit forms** where list data is already loaded
- **Detail/preview panels** that expand from a list
- **Navigation** between list → detail views
- **Any mutation** (create/update/delete) that should reflect instantly in the UI
- **Multi-step flows** where earlier steps have data needed by later steps
- **Dashboard widgets** that share underlying data

## When NOT to Apply

- **Security-sensitive reads** where stale data is dangerous (payment amounts, permissions)
- **Real-time collaborative editing** where conflicts must be detected immediately
- **Large datasets** where caching consumes too much memory
