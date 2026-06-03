export const toProjectRunRequest = (inputValuesText: string) => {
  const trimmed = inputValuesText.trim()

  if (trimmed.length === 0) {
    return undefined
  }

  return {
    inputValues: JSON.parse(trimmed) as Record<string, unknown>,
  }
}

export const missingRequiredProjectInputs = (
  request: { readonly inputValues?: Record<string, unknown> } | undefined,
  requiredInputs: ReadonlyArray<string>,
) => {
  const providedInputs = request?.inputValues ?? {}

  return requiredInputs.filter((inputName) => !(inputName in providedInputs))
}
