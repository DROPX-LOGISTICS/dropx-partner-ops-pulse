"use server";

/**
 * Thin server-action entry for client forms.
 * Keeps associate-entry-builder from statically binding the full actions module graph.
 */
export async function saveExecutiveReconciliation(formData: FormData) {
  const actions = await import("./actions");
  return actions.saveExecutiveReconciliation(formData);
}

export async function deleteExecutiveReconciliation(formData: FormData) {
  const actions = await import("./actions");
  return actions.deleteExecutiveReconciliation(formData);
}
