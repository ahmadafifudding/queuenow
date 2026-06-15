/*
 * Required-field gating for the Kiosk join form (R12.3).
 *
 * The set of fields the Kiosk requires is driven entirely by the org's
 * `QueueSettings`: the customer name is required when (and only when)
 * `requireName` is set, and the phone when (and only when) `requirePhone` is
 * set. Validation is layered on top of the shared `joinQueueSchema` from
 * `@queuenow/shared-validation` (which already validates `serviceId` and types
 * the optional `customerName`/`customerPhone`) so the Kiosk never redefines the
 * base contract — it only tightens the two optional fields into required ones
 * when the settings demand it.
 *
 * These helpers are intentionally PURE (no React, no I/O) so they can be unit-
 * and property-tested directly — Property 17 (task 16.2) asserts that the
 * required-field set matches the settings for every `requireName`/`requirePhone`
 * combination.
 */
import { joinQueueSchema, type JoinQueueInput } from '@queuenow/shared-validation';
import { z } from 'zod';

import { strings } from '@/i18n';

import type { KioskQueueSettings } from '../types';

/** Whether each collectable Kiosk field is required for the given settings. */
export interface KioskRequiredFields {
  /** True when the customer name must be provided (mirrors `requireName`). */
  name: boolean;
  /** True when the customer phone must be provided (mirrors `requirePhone`). */
  phone: boolean;
}

/**
 * Resolve which fields the Kiosk must collect from the queue settings (R12.3).
 *
 * @param settings - the org's queue settings.
 * @returns the required-field flags, mirroring `requireName`/`requirePhone`.
 */
export function kioskRequiredFields(settings: KioskQueueSettings): KioskRequiredFields {
  return { name: settings.requireName, phone: settings.requirePhone };
}

/** A non-empty (after trimming) string, used to enforce a required text field. */
function isBlank(value: string | undefined): boolean {
  return value === undefined || value.trim().length === 0;
}

/**
 * Build the Kiosk join validation schema for the given settings (R12.3).
 *
 * Starts from the shared {@link joinQueueSchema} and adds a refinement that
 * requires `customerName`/`customerPhone` exactly when the settings require
 * them, attaching the issue to the matching field path so the field path
 * surfaces inline. The serializable shape stays equal to {@link JoinQueueInput}.
 *
 * @param settings - the org's queue settings.
 * @returns a Zod schema that gates the required fields per the settings.
 */
export function buildKioskJoinSchema(
  settings: KioskQueueSettings,
): z.ZodType<JoinQueueInput, z.ZodTypeDef, unknown> {
  const { name: nameRequired, phone: phoneRequired } = kioskRequiredFields(settings);

  return joinQueueSchema.superRefine((value, ctx) => {
    if (nameRequired && isBlank(value.customerName)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['customerName'],
        message: strings.kiosk.validation.nameRequired,
      });
    }
    if (phoneRequired && isBlank(value.customerPhone)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['customerPhone'],
        message: strings.kiosk.validation.phoneRequired,
      });
    }
  });
}
