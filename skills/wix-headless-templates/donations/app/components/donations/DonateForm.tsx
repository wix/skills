// The donate form for one campaign — wire as-is on the campaign page (and a home strip). It owns
// the rules a rewritten form gets wrong: the frequency picker only when the campaign offers more
// than one frequency, the preset amounts with the owner's impact text, "Other amount" only when
// the owner enabled it (with the campaign's min/max in the messages), the cover-fee checkbox with
// the computed 2.9% only when the owner asks, the note only when comments are enabled (with its
// counter), the live "Donate $25 Monthly" label, "Redirecting…" while the hosted checkout starts,
// errors shown after the first attempt, the failure inline. For a campaign that isn't accepting
// donations (goal reached / expired) it renders `children` — your closing message — or nothing.
// The redirect itself is useDonation → donationCheckoutUrl; nothing here builds a URL or marks
// anything paid.
import { useId, type ReactNode } from "react";
import { useDonation, type UseDonationOptions } from "../../hooks/donations/useDonation";
import type { CampaignDetail } from "../../wix/donations/types";

export interface DonateFormProps {
  campaign: CampaignDetail;
  /** origin / return paths for the hosted flow — see donate.ts; omit for the defaults. */
  options?: UseDonationOptions;
  /** Rendered instead of the form when the campaign isn't accepting donations. */
  children?: ReactNode;
  className?: string;
  buttonClassName?: string;
}

const choice = (selected: boolean) =>
  `relative block cursor-pointer rounded-md border px-4 py-3 text-sm transition-colors focus-within:outline-2 focus-within:outline-offset-2 focus-within:outline-primary ${
    selected ? "border-primary bg-primary text-primary-foreground" : "border-border bg-background text-foreground hover:bg-secondary"
  }`;

export default function DonateForm({
  campaign,
  options,
  children,
  className = "grid gap-6",
  buttonClassName = "w-full rounded-control bg-primary px-8 py-3 text-sm font-semibold text-primary-foreground transition-opacity hover:opacity-90 disabled:opacity-50",
}: DonateFormProps) {
  const d = useDonation(campaign, options);
  const o = campaign.options;
  const fid = `donate-${campaign.id}-${useId()}`;
  if (!d.available) return children ? <>{children}</> : null;

  const show = (field: keyof typeof d.messages) => (d.showErrors && d.messages[field] ? d.messages[field] : null);

  return (
    <form
      className={className}
      noValidate
      onSubmit={(e) => {
        e.preventDefault();
        const form = e.currentTarget;
        void d.donate().then(() => {
          if (!d.valid) {
            // Wait for the store's validation state to render; do not steal focus while typing.
            requestAnimationFrame(() => form.querySelector<HTMLElement>('[aria-invalid="true"]')?.focus());
          }
        }).catch((error) => {
          // The store shows a recoverable message; keep safe diagnostics, not donor data or tokens.
          console.error("Donation checkout failed", {
            stage: error?.stage ?? "checkout",
            status: error?.status,
            code: error?.body?.details?.applicationError?.code ?? error?.details?.applicationError?.code ?? error?.body?.code,
          });
        });
      }}
    >
      {o.frequencies.length > 1 && (
        <fieldset disabled={d.submitting}>
          <legend className="eyebrow mb-2">How often</legend>
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
            {o.frequencies.map((f) => (
              <label key={f.value} className={choice(d.frequency === f.value)}>
                <input type="radio" name={`${fid}-frequency`} value={f.value} checked={d.frequency === f.value}
                  onChange={() => d.setFrequency(f.value)} className="sr-only"
                  aria-invalid={!!show("frequency")} aria-describedby={show("frequency") ? `${fid}-frequency-error` : undefined} />
                {f.label}
              </label>
            ))}
          </div>
          {show("frequency") && <p id={`${fid}-frequency-error`} className="mt-2 text-sm text-destructive" role="alert">{show("frequency")}</p>}
        </fieldset>
      )}

      {(o.presets.length > 0 || o.customAmount.enabled) && (
        <fieldset disabled={d.submitting}>
          <legend className="eyebrow mb-2">Amount</legend>
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
            {o.presets.map((p) => {
              const selected = !d.customMode && d.presetAmount === p.amount;
              return (
                <label key={p.amount} className={`${choice(selected)} text-left`}>
                  <input type="radio" name={`${fid}-amount-choice`} value={p.amount} checked={selected}
                    onChange={() => d.selectPreset(p.amount)} className="sr-only"
                    aria-invalid={!!show("amount")} aria-describedby={show("amount") ? `${fid}-amount-error` : undefined} />
                  <span className="block text-base font-semibold">{p.label}</span>
                  {p.impact && <span className={`mt-0.5 block text-xs ${selected ? "opacity-80" : "text-muted-foreground"}`}>{p.impact}</span>}
                </label>
              );
            })}
            {o.customAmount.enabled && o.presets.length > 0 && (
              <label className={choice(d.customMode)}>
                <input type="radio" name={`${fid}-amount-choice`} value="custom" checked={d.customMode}
                  onChange={() => d.selectCustom()} className="sr-only"
                  aria-invalid={!!show("amount")} aria-describedby={show("amount") ? `${fid}-amount-error` : undefined} />
                Other amount
              </label>
            )}
          </div>
          {show("amount") && <p id={`${fid}-amount-error`} className="mt-2 text-sm text-destructive" role="alert">{show("amount")}</p>}
          {d.customMode && (
            <div className="mt-3">
              <label htmlFor={`${fid}-amount`} className="sr-only">
                Amount{o.currency ? ` in ${o.currency}` : ""}
              </label>
              <div className="flex items-center gap-2 rounded-md border border-border bg-background px-3">
                {o.currency && <span className="text-sm text-muted-foreground">{o.currency}</span>}
                <input
                  id={`${fid}-amount`}
                  inputMode="decimal"
                  autoComplete="off"
                  className="min-w-0 flex-1 bg-transparent py-3 text-base text-foreground outline-none focus-visible:ring-2 focus-visible:ring-primary"
                  placeholder={o.customAmount.minLabel ? `${o.customAmount.minLabel} or more` : "Enter an amount"}
                  value={d.customAmount}
                  onChange={(e) => d.setCustomAmount(e.target.value)}
                  aria-invalid={!!show("customAmount")}
                  aria-describedby={show("customAmount") || o.customAmount.minLabel || o.customAmount.maxLabel ? `${fid}-custom-help` : undefined}
                />
              </div>
              {(o.customAmount.minLabel || o.customAmount.maxLabel) && !show("customAmount") && (
                <p id={`${fid}-custom-help`} className="mt-1 text-xs text-muted-foreground">
                  {[o.customAmount.minLabel && `Minimum ${o.customAmount.minLabel}`, o.customAmount.maxLabel && `Maximum ${o.customAmount.maxLabel}`].filter(Boolean).join(" · ")}
                </p>
              )}
              {show("customAmount") && <p id={`${fid}-custom-help`} className="mt-1 text-sm text-destructive" role="alert">{show("customAmount")}</p>}
            </div>
          )}
        </fieldset>
      )}

      {o.askCoverFee && (
        <label className="flex items-start gap-3 text-sm text-foreground">
          <input type="checkbox" className="mt-0.5" checked={d.coverFee} disabled={d.submitting} onChange={(e) => d.setCoverFee(e.target.checked)} />
          <span>
            {d.feeLabel ? `Add ${d.feeLabel} to cover the processing fees` : "Cover the processing fees (2.9%)"}
            {d.frequency && d.frequency !== "ONE_TIME" && <span className="text-muted-foreground"> — on every payment</span>}
          </span>
        </label>
      )}

      {o.commentsEnabled && (
        <div>
          <label htmlFor={`${fid}-note`} className="eyebrow mb-2 block">
            Leave a note <span className="font-normal normal-case tracking-normal">(optional)</span>
          </label>
          <textarea
            id={`${fid}-note`}
            rows={3}
            maxLength={o.commentMaxLength}
            className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm text-foreground outline-none focus-visible:ring-2 focus-visible:ring-primary"
            value={d.note}
            onChange={(e) => d.setNote(e.target.value)}
            disabled={d.submitting}
            aria-invalid={!!show("note")}
            aria-describedby={`${fid}-note-hint${show("note") ? ` ${fid}-note-error` : ""}`}
          />
          <p id={`${fid}-note-hint`} className="mt-1 text-right text-xs text-muted-foreground">
            {d.note.length}/{o.commentMaxLength}
          </p>
          {show("note") && <p id={`${fid}-note-error`} className="text-sm text-destructive" role="alert">{show("note")}</p>}
        </div>
      )}

      <div className="grid gap-2">
        <button type="submit" disabled={d.submitting} aria-busy={d.submitting} className={buttonClassName}>
          {d.submitting ? "Redirecting…" : d.buttonLabel}
        </button>
        {d.error && <p className="text-sm text-destructive" role="alert">{d.error}</p>}
        <p className="text-center text-xs text-muted-foreground">Secure payment on the next step.</p>
      </div>
    </form>
  );
}
