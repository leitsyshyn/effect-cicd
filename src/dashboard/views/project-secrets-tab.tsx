import { zodResolver } from "@hookform/resolvers/zod"
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { useForm } from "react-hook-form"
import { z } from "zod"

import { Alert, AlertDescription, AlertTitle } from "../components/ui/alert.tsx"
import { Button } from "../components/ui/button.tsx"
import { Card, CardContent, CardFooter, CardHeader, CardTitle } from "../components/ui/card.tsx"
import { Field, FieldDescription, FieldError, FieldGroup, FieldLabel } from "../components/ui/field.tsx"
import { Input } from "../components/ui/input.tsx"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "../components/ui/table.tsx"
import { Textarea } from "../components/ui/textarea.tsx"
import { dashboardApi, dashboardQueries, dashboardQueryKeys } from "../lib/dashboard-query.ts"
import { formatDateTime } from "../lib/format.ts"

const secretSchema = z.object({
  key: z.string().trim().min(1, "Key is required."),
  value: z.string().min(1, "Value is required."),
})

type SecretFormValues = z.infer<typeof secretSchema>

export function ProjectSecretsTab(props: { readonly projectId: string }) {
  const queryClient = useQueryClient()
  const secretsQuery = useQuery(dashboardQueries.projectSecrets(props.projectId))
  const form = useForm<SecretFormValues>({
    resolver: zodResolver(secretSchema),
    defaultValues: { key: "", value: "" },
  })

  const setSecretMutation = useMutation({
    mutationFn: (values: SecretFormValues) =>
      dashboardApi.setSecret({ projectId: props.projectId, key: values.key.trim(), value: values.value }),
    onSuccess: async () => {
      form.reset()
      await queryClient.invalidateQueries({ queryKey: dashboardQueryKeys.projectSecrets(props.projectId) })
    },
  })

  const deleteSecretMutation = useMutation({
    mutationFn: (secretKey: string) => dashboardApi.deleteSecret(props.projectId, secretKey),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: dashboardQueryKeys.projectSecrets(props.projectId) })
    },
  })

  const submit = form.handleSubmit(async (values) => {
    await setSecretMutation.mutateAsync(values)
  })

  const removeSecret = async (secretKey: string) => {
    if (!window.confirm(`Delete secret ${secretKey}?`)) {
      return
    }

    await deleteSecretMutation.mutateAsync(secretKey).catch(() => undefined)
  }

  return (
    <section className="grid gap-4">
      <Card>
        <CardHeader>
          <CardTitle>Add Secret</CardTitle>
        </CardHeader>
        <CardContent>
          <form onSubmit={(event) => void submit(event)}>
            <FieldGroup>
              <Field data-invalid={form.formState.errors.key !== undefined}>
                <FieldLabel htmlFor="secret-key">Key</FieldLabel>
                <Input id="secret-key" className="font-mono" placeholder="API_TOKEN" aria-invalid={form.formState.errors.key !== undefined} {...form.register("key")} />
                <FieldDescription>Use uppercase names for consistency.</FieldDescription>
                {form.formState.errors.key === undefined ? null : <FieldError>{form.formState.errors.key.message}</FieldError>}
              </Field>

              <Field data-invalid={form.formState.errors.value !== undefined}>
                <FieldLabel htmlFor="secret-value">Value</FieldLabel>
                <Textarea id="secret-value" aria-invalid={form.formState.errors.value !== undefined} {...form.register("value")} />
                {form.formState.errors.value === undefined ? null : <FieldError>{form.formState.errors.value.message}</FieldError>}
              </Field>
            </FieldGroup>
          </form>
          {setSecretMutation.error === null ? null : <FieldError className="mt-4">{setSecretMutation.error.message}</FieldError>}
        </CardContent>
        <CardFooter className="justify-end gap-2">
          <Button type="button" variant="outline" size="sm" onClick={() => form.reset()} disabled={setSecretMutation.isPending}>
            Reset
          </Button>
          <Button size="sm" onClick={() => void submit()} disabled={setSecretMutation.isPending}>
            {setSecretMutation.isPending ? "Saving..." : "Save Secret"}
          </Button>
        </CardFooter>
      </Card>

      {secretsQuery.isPending ? <p className="text-sm text-muted-foreground">Loading secrets...</p> : null}
      {secretsQuery.error === null ? null : (
        <Alert variant="destructive">
          <AlertTitle>Failed to load secrets</AlertTitle>
          <AlertDescription>{secretsQuery.error.message}</AlertDescription>
        </Alert>
      )}
      {deleteSecretMutation.error === null ? null : (
        <Alert variant="destructive">
          <AlertTitle>Failed to delete secret</AlertTitle>
          <AlertDescription>{deleteSecretMutation.error.message}</AlertDescription>
        </Alert>
      )}

      {!secretsQuery.isPending && secretsQuery.error === null && (secretsQuery.data?.length ?? 0) === 0 ? (
        <Card>
          <CardContent className="pt-5 text-sm text-muted-foreground">No secrets for this project.</CardContent>
        </Card>
      ) : null}

      {!secretsQuery.isPending && secretsQuery.error === null && (secretsQuery.data?.length ?? 0) > 0 ? (
        <Card>
          <CardContent className="p-0">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Key</TableHead>
                  <TableHead>Created</TableHead>
                  <TableHead>Updated</TableHead>
                  <TableHead>Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {secretsQuery.data!.map((secret) => (
                  <TableRow key={secret.key}>
                    <TableCell className="font-mono text-xs">{secret.key}</TableCell>
                    <TableCell>{formatDateTime(secret.createdAt)}</TableCell>
                    <TableCell>{formatDateTime(secret.updatedAt)}</TableCell>
                    <TableCell>
                      <Button variant="ghost" size="sm" className="text-destructive hover:text-destructive" onClick={() => void removeSecret(secret.key)} disabled={deleteSecretMutation.isPending}>
                        Delete
                      </Button>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      ) : null}
    </section>
  )
}
