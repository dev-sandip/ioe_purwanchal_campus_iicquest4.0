---
name: form-stack
description: Type-safe form architecture for Next.js product engineers. React Hook Form + Zod + shadcn/ui Form primitives, with one Zod schema driving validation, types, and the API contract. Apply when building any create/edit form, multi-step wizard, or form that submits via Server Action or React Query mutation. Covers field wiring, server-error mapping, field arrays, async validation, and the loading/disabled states most forms get wrong.
topics: [react-patterns, architecture]
---

# Form Stack

A single, repeatable pattern for every form in a product app. Built on **React Hook Form** (state + validation lifecycle), **Zod** (one schema for validation _and_ types), and **shadcn/ui `Form`** primitives (accessible field wiring).

The core idea: **the Zod schema is the single source of truth.** It validates the form, infers the TypeScript types, and matches the API contract. You never write a form type by hand.

This skill pairs with [product-stack](/skills/product-stack) — reuse the exact `createXSchema` you defined in `schemas/` to drive the form, and submit through the same React Query hooks.

---

## Principles

1. **One schema, three jobs** — validation, types (`z.infer`), and the request body all come from the same Zod schema. Never duplicate the shape.
2. **Uncontrolled by default** — RHF registers inputs and tracks them via refs. Don't lift every field into `useState`; let the form own its state.
3. **Validate on the right trigger** — `onBlur` for create forms, `onChange` only once a field has errored. Don't validate aggressively on every keystroke from the start.
4. **Server errors map back to fields** — a 409 "email taken" belongs on the email field via `setError`, not just a toast.
5. **Submit is one async function** — disable the form while it runs, surface field/root errors on failure, reset or redirect on success.
6. **The schema is the contract** — if the API rejects a payload the schema accepted, the schema is wrong. Fix it there, not with ad-hoc checks.

---

## Setup

```bash
pnpm add react-hook-form zod @hookform/resolvers
npx shadcn@latest add form input button
```

shadcn's `form` component gives you `Form`, `FormField`, `FormItem`, `FormLabel`, `FormControl`, `FormDescription`, and `FormMessage` — thin wrappers over RHF's `Controller` that wire up `id`, `aria-describedby`, and `aria-invalid` automatically. Use them; do not hand-roll labels and error text.

---

## The Schema (source of truth)

Reuse the resource schema from `schemas/` (see [product-stack](/skills/product-stack) Layer 3). The same schema validates the form and the API route.

```typescript
// schemas/project.ts
import { z } from "zod";

export const createProjectSchema = z.object({
  name: z.string().min(1, "Name is required").max(100),
  description: z.string().max(500).optional(),
  status: z.enum(["draft", "active", "archived"]).default("draft"),
  visibility: z.enum(["public", "private"]),
  tags: z.array(z.string().min(1)).max(10).default([]),
});

export type CreateProjectInput = z.infer<typeof createProjectSchema>;
```

**Rule:** form components import `CreateProjectInput` — they never define a `ProjectFormValues` interface by hand.

---

## The Base Form Pattern

Every form follows this shape. Memorize it.

```tsx
"use client";

import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import {
  Form,
  FormControl,
  FormDescription,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from "@/components/ui/form";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import {
  createProjectSchema,
  type CreateProjectInput,
} from "@/schemas/project";

export function ProjectForm() {
  const form = useForm<CreateProjectInput>({
    resolver: zodResolver(createProjectSchema),
    mode: "onBlur",
    defaultValues: {
      name: "",
      description: "",
      status: "draft",
      visibility: "private",
      tags: [],
    },
  });

  async function onSubmit(values: CreateProjectInput) {
    // submit logic — see "Submitting" below
  }

  return (
    <Form {...form}>
      <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-6">
        <FormField
          control={form.control}
          name="name"
          render={({ field }) => (
            <FormItem>
              <FormLabel>Name</FormLabel>
              <FormControl>
                <Input placeholder="Acme dashboard" {...field} />
              </FormControl>
              <FormDescription>Shown across your workspace.</FormDescription>
              <FormMessage />
            </FormItem>
          )}
        />

        <Button type="submit" disabled={form.formState.isSubmitting}>
          {form.formState.isSubmitting ? "Saving..." : "Create project"}
        </Button>
      </form>
    </Form>
  );
}
```

**Rules:**

- Always provide `defaultValues` for **every** field. Missing defaults make inputs uncontrolled→controlled and React warns. Use `""`, `[]`, or the enum default — never `undefined` for a rendered field.
- `resolver: zodResolver(schema)` — one line connects Zod to RHF.
- `{...field}` spreads `value`, `onChange`, `onBlur`, `name`, `ref` onto the input. Don't destructure them manually unless you need to wrap one.
- `<FormMessage />` renders the field's Zod error automatically. Never write `{errors.name?.message}` yourself.
- Submit through `form.handleSubmit(onSubmit)` — it validates first and only calls `onSubmit` with typed, valid data.

---

## Validation Mode

```typescript
useForm({
  mode: "onBlur", // validate when a field loses focus (good default for create)
  reValidateMode: "onChange", // after first error, re-check on every change
});
```

| Form type            | `mode`     | Why                                            |
| -------------------- | ---------- | ---------------------------------------------- |
| Create / long form   | `onBlur`   | Don't yell before the user finishes a field    |
| Edit / settings      | `onChange` | Instant feedback, user knows the existing data |
| Search / filter      | `onChange` | Live filtering                                 |
| Single-action submit | `onSubmit` | Only validate when they commit                 |

`reValidateMode: "onChange"` is almost always right: silent until the first error, then live until it's fixed.

---

## Submitting

Two valid paths. Pick by who consumes the mutation (same rule as [product-stack](/skills/product-stack)).

### Path A — React Query mutation (client form → API route)

Reuse the hook from your resource. The hook owns the toast and cache invalidation; the form owns field state.

```tsx
import { useCreateProject } from "@/hooks/use-projects";

export function ProjectForm({ onSuccess }: { onSuccess?: () => void }) {
  const form = useForm<CreateProjectInput>({
    /* ...as above */
  });
  const createProject = useCreateProject();

  async function onSubmit(values: CreateProjectInput) {
    try {
      await createProject.mutateAsync(values);
      form.reset();
      onSuccess?.();
    } catch (error) {
      applyServerErrors(form, error); // map field errors — see below
    }
  }

  const isSubmitting = createProject.isPending;

  return (
    <Form {...form}>
      <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-6">
        {/* fields */}
        <Button type="submit" disabled={isSubmitting}>
          {isSubmitting ? "Saving..." : "Create project"}
        </Button>
      </form>
    </Form>
  );
}
```

Use `mutateAsync` (not `mutate`) inside the submit handler so you can `await` and `try/catch` to map field errors. Drive the disabled state from `mutation.isPending`, not `formState.isSubmitting`, when submitting via React Query.

### Path B — Server Action (form is the only consumer)

```tsx
"use client";

import { useTransition } from "react";
import { createProjectAction } from "@/app/actions/project";

export function ProjectForm() {
  const form = useForm<CreateProjectInput>({ /* ... */ });
  const [isPending, startTransition] = useTransition();

  function onSubmit(values: CreateProjectInput) {
    startTransition(async () => {
      const result = await createProjectAction(values);
      if (result?.fieldErrors) {
        for (const [field, message] of Object.entries(result.fieldErrors)) {
          form.setError(field as keyof CreateProjectInput, { message });
        }
        return;
      }
      form.reset();
    });
  }

  return (/* ...Form... */);
}
```

The Server Action re-validates with the **same schema** and returns structured `fieldErrors` — never trust client validation alone.

```typescript
// app/actions/project.ts
"use server";

import { createProjectSchema } from "@/schemas/project";

export async function createProjectAction(input: unknown) {
  const parsed = createProjectSchema.safeParse(input);
  if (!parsed.success) {
    return { fieldErrors: z.flattenError(parsed.error).fieldErrors };
  }
  // ...persist, revalidatePath
}
```

---

## Mapping Server Errors to Fields

A toast for "email already taken" is a worse UX than a red message under the email field. Map known server errors back onto the form, fall back to a root error for everything else.

```typescript
import type { UseFormReturn, FieldValues, Path } from "react-hook-form";
import { AxiosError } from "axios";

export function applyServerErrors<T extends FieldValues>(
  form: UseFormReturn<T>,
  error: unknown,
) {
  if (error instanceof AxiosError) {
    const data = error.response?.data as
      | { fieldErrors?: Record<string, string[]>; error?: string }
      | undefined;

    // Per-field errors (e.g. from z.flattenError on the server)
    if (data?.fieldErrors) {
      for (const [field, messages] of Object.entries(data.fieldErrors)) {
        form.setError(field as Path<T>, { message: messages[0] });
      }
      return;
    }

    // Single field conflict, e.g. 409 unique violation
    if (error.response?.status === 409) {
      form.setError("name" as Path<T>, {
        message: data?.error ?? "Already exists",
      });
      return;
    }
  }

  // Fallback: form-level error, render with <FormMessage /> on root
  form.setError("root.serverError", {
    message: "Something went wrong. Please try again.",
  });
}
```

Render the root error above the submit button:

```tsx
{
  form.formState.errors.root?.serverError && (
    <p className="text-sm text-destructive">
      {form.formState.errors.root.serverError.message}
    </p>
  );
}
```

**Rules:**

- `setError` for known fields; `setError("root.serverError", ...)` for unknown failures.
- `root` errors clear on next submit automatically; field errors clear when the field changes.
- Server validation must mirror the client schema. The client schema is UX; the server schema is the gate.

---

## Non-Input Fields (Select, Checkbox, Switch, RadioGroup)

These don't accept `{...field}` directly — they expose `value`/`onValueChange` (or `checked`/`onCheckedChange`). Wire them explicitly inside the `render` callback.

```tsx
<FormField
  control={form.control}
  name="status"
  render={({ field }) => (
    <FormItem>
      <FormLabel>Status</FormLabel>
      <Select onValueChange={field.onChange} value={field.value}>
        <FormControl>
          <SelectTrigger>
            <SelectValue placeholder="Select status" />
          </SelectTrigger>
        </FormControl>
        <SelectContent>
          <SelectItem value="draft">Draft</SelectItem>
          <SelectItem value="active">Active</SelectItem>
          <SelectItem value="archived">Archived</SelectItem>
        </SelectContent>
      </Select>
      <FormMessage />
    </FormItem>
  )}
/>
```

```tsx
{
  /* Checkbox / Switch — boolean fields */
}
<FormField
  control={form.control}
  name="isPublic"
  render={({ field }) => (
    <FormItem className="flex flex-row items-center justify-between rounded-lg border p-4">
      <div className="space-y-0.5">
        <FormLabel>Public project</FormLabel>
        <FormDescription>Anyone with the link can view.</FormDescription>
      </div>
      <FormControl>
        <Switch checked={field.value} onCheckedChange={field.onChange} />
      </FormControl>
    </FormItem>
  )}
/>;
```

**Rule:** keep `<FormControl>` wrapping the _trigger_ of compound components (Select, Popover) so the label/`aria-describedby` wiring stays correct.

---

## Field Arrays (repeatable rows)

Use `useFieldArray` for dynamic lists (tags, team members, line items). Never manage an array of inputs with `useState` alongside RHF.

```tsx
import { useFieldArray } from "react-hook-form";

const { fields, append, remove } = useFieldArray({
  control: form.control,
  name: "members", // schema: members: z.array(z.object({ email: z.string().email() }))
});

return (
  <div className="space-y-3">
    {fields.map((item, index) => (
      <div key={item.id} className="flex gap-2">
        <FormField
          control={form.control}
          name={`members.${index}.email`}
          render={({ field }) => (
            <FormItem className="flex-1">
              <FormControl>
                <Input placeholder="teammate@acme.com" {...field} />
              </FormControl>
              <FormMessage />
            </FormItem>
          )}
        />
        <Button type="button" variant="ghost" onClick={() => remove(index)}>
          Remove
        </Button>
      </div>
    ))}
    <Button
      type="button"
      variant="outline"
      onClick={() => append({ email: "" })}
    >
      Add member
    </Button>
  </div>
);
```

**Rules:**

- Use `item.id` (RHF's stable generated key) for `key`, **not** the array index. Index keys break on reorder/remove.
- Name fields with template paths: `members.${index}.email`.
- Append a fully-shaped object (`{ email: "" }`), not `{}`, so defaults stay consistent.

---

## Async Validation (e.g. "is this slug available?")

Two options. Prefer Zod's async `refine` for one-off checks; debounce a watched value for live feedback.

```typescript
// In the schema — runs on submit and on validation triggers
export const createProjectSchema = z.object({
  slug: z
    .string()
    .min(1)
    .refine(
      async (slug) => {
        const res = await fetch(`/api/projects/slug-available?slug=${slug}`);
        const { available } = await res.json();
        return available;
      },
      { message: "That slug is taken" },
    ),
});
```

For live feedback without hammering the API, debounce a watched field and call `form.setError`/`form.clearErrors` manually:

```tsx
const slug = form.watch("slug");
useEffect(() => {
  if (!slug) return;
  const t = setTimeout(async () => {
    const res = await fetch(`/api/projects/slug-available?slug=${slug}`);
    const { available } = await res.json();
    if (!available) form.setError("slug", { message: "That slug is taken" });
    else form.clearErrors("slug");
  }, 400);
  return () => clearTimeout(t);
}, [slug, form]);
```

**Rule:** always debounce network-backed validation (300–500ms). Always still validate on the server — async client checks are a convenience, not a guarantee.

---

## Edit Forms (pre-filled data)

For edit forms, seed `defaultValues` from fetched data and reset when it loads. Pairs naturally with [optimistic-cache-pattern](/skills/optimistic-cache-pattern) — open with cached values, `reset()` when full data resolves.

```tsx
const { data: project } = useProject(id);

const form = useForm<UpdateProjectInput>({
  resolver: zodResolver(updateProjectSchema),
  defaultValues: project ?? { name: "", description: "" },
});

// Re-seed when data arrives or changes
useEffect(() => {
  if (project) form.reset(project);
}, [project, form]);
```

**Rules:**

- `form.reset(data)` is the correct way to load values async — not `setValue` per field.
- Use `form.formState.isDirty` to disable "Save" until the user actually changed something.
- Send only changed fields if your API supports `PATCH`: `form.formState.dirtyFields` tells you which.

---

## Multi-Step / Wizard Forms

One `useForm` instance spanning all steps. Validate only the current step's fields before advancing.

```tsx
const steps = [
  ["name", "description"],
  ["status", "visibility"],
  ["tags"],
] as const;
const [step, setStep] = useState(0);

async function next() {
  const valid = await form.trigger(steps[step]); // validate only this step's fields
  if (valid) setStep((s) => s + 1);
}
```

**Rules:**

- Keep a single form instance; don't create one per step (you'd lose state between steps).
- `form.trigger(fieldNames)` validates a subset on demand.
- Only call `handleSubmit` on the final step.
- Persist `form.getValues()` to `sessionStorage` if steps can be navigated away from.

---

## Loading & Disabled States

The states most forms get wrong:

```tsx
const isSubmitting = mutation.isPending; // or form.formState.isSubmitting for actions

<fieldset disabled={isSubmitting} className="space-y-6 disabled:opacity-70">
  {/* all fields disable together via fieldset */}
</fieldset>

<Button type="submit" disabled={isSubmitting || !form.formState.isDirty}>
  {isSubmitting ? "Saving..." : "Save changes"}
</Button>
```

**Rules:**

- Wrap fields in a `<fieldset disabled={isSubmitting}>` to disable the whole form in one place.
- Disable submit while pending **and** (for edit forms) when `!isDirty`.
- Don't unmount the form on success if you show inline confirmation — `form.reset()` instead.

---

## Common Mistakes

1. **Hand-written form types** — Always `z.infer<typeof schema>`. Never `interface ProjectFormValues`.
2. **Missing `defaultValues`** — Every rendered field needs a default (`""`, `[]`, enum value). Omitting them triggers controlled/uncontrolled warnings.
3. **Index as `useFieldArray` key** — Use `field.id`. Index keys corrupt state on remove/reorder.
4. **`mutate` instead of `mutateAsync` in submit** — You can't `await`/`catch` `mutate`, so server-error mapping silently fails.
5. **Server errors only as toasts** — Map known field errors with `setError`; reserve toasts/root errors for unknown failures.
6. **No server-side validation** — Client validation is UX. The Server Action / route handler must re-validate with the same schema.
7. **Validating on `onChange` from the start** — Aggressive validation before the user finishes typing feels hostile. Default to `onBlur` + `reValidateMode: onChange`.
8. **`setValue` to load edit data field-by-field** — Use `form.reset(data)`.
9. **Reading `errors.field?.message` manually** — `<FormMessage />` already does this with correct `aria` wiring.
10. **Lifting field values into `useState`** — Let RHF own form state. Only `watch` what you need to react to.
11. **Forgetting `type="button"`** — Any non-submit button inside a `<form>` (add/remove row, next step) must be `type="button"` or it submits the form.
12. **Not disabling submit while pending** — Double-submits create duplicate records. Disable on `isPending`.

---

## Tech Stack

- **React Hook Form** — form state, validation lifecycle, field arrays
- **Zod** — one schema for validation + types + API contract
- **@hookform/resolvers** — `zodResolver` bridge
- **shadcn/ui `Form`** — accessible `FormField`/`FormItem`/`FormControl`/`FormMessage` wiring
- **TanStack React Query** — mutation submit path (or **Server Actions** for app-only forms)
- **Sonner** — success/error toasts (in the hook, not the form)
