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
import type { ReactNode } from "react";
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
  `cursor-pointer rounded-md border px-4 py-3 text-sm transition-colors ${
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
  if (!d.available) return children ? <>{children}</> : null;

  const show = (field: keyof typeof d.messages) => (d.showErrors && d.messages[field] ? d.messages[field] : null);
  const fid = `donate-${campaign.id}`;

  return (
    <form
      className={className}
      noValidate
      onSubmit={(e) => {
        e.preventDefault();
        void d.donate().catch(() => {});
      }}
    >
      {o.frequencies.length > 1 && (
        <fieldset>
          <legend className="eyebrow mb-2">How often</legend>
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-4" role="radiogroup">
            {o.frequencies.map((f) => (
              <button key={f.value} type="button" role="radio" aria-checked={d.frequency === f.value} className={choice(d.frequency === f.value)} onClick={() => d.setFrequency(f.value)}>
                {f.label}
              </button>
            ))}
          </div>
          {show("frequency") && <p className="mt-2 text-sm text-destructive" role="alert">{show("frequency")}</p>}
        </fieldset>
      )}

      {(o.presets.length > 0 || o.customAmount.enabled) && (
        <fieldset>
          <legend className="eyebrow mb-2">Amount</legend>
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-3" role="radiogroup">
            {o.presets.map((p) => {
              const selected = !d.customMode && d.presetAmount === p.amount;
              return (
                <button key={p.amount} type="button" role="radio" aria-checked={selected} className={`${choice(selected)} text-left`} onClick={() => d.selectPreset(p.amount)}>
                  <span className="block text-base font-semibold">{p.label}</span>
                  {p.impact && <span className={`mt-0.5 block text-xs ${selected ? "opacity-80" : "text-muted-foreground"}`}>{p.impact}</span>}
                </button>
              );
            })}
            {o.customAmount.enabled && o.presets.length > 0 && (
              <button type="button" role="radio" aria-checked={d.customMode} className={choice(d.customMode)} onClick={() => d.selectCustom()}>
                Other amount
              </button>
            )}
          </div>
          {show("amount") && <p className="mt-2 text-sm text-destructive" role="alert">{show("amount")}</p>}
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
                  className="w-full bg-transparent py-3 text-base text-foreground outline-none"
                  placeholder={o.customAmount.minLabel ? `${o.customAmount.minLabel} or more` : "Enter an amount"}
                  value={d.customAmount}
                  onChange={(e) => d.setCustomAmount(e.target.value)}
                  aria-invalid={!!show("customAmount")}
                />
              </div>
              {(o.customAmount.minLabel || o.customAmount.maxLabel) && !show("customAmount") && (
                <p className="mt-1 text-xs text-muted-foreground">
                  {[o.customAmount.minLabel && `Minimum ${o.customAmount.minLabel}`, o.customAmount.maxLabel && `Maximum ${o.customAmount.maxLabel}`].filter(Boolean).join(" · ")}
                </p>
              )}
              {show("customAmount") && <p className="mt-1 text-sm text-destructive" role="alert">{show("customAmount")}</p>}
            </div>
          )}
        </fieldset>
      )}

      {o.askCoverFee && (
        <label className="flex items-start gap-3 text-sm text-foreground">
          <input type="checkbox" className="mt-0.5" checked={d.coverFee} onChange={(e) => d.setCoverFee(e.target.checked)} />
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
            className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm text-foreground outline-none"
            value={d.note}
            onChange={(e) => d.setNote(e.target.value)}
          />
          <p className="mt-1 text-right text-xs text-muted-foreground">
            {d.note.length}/{o.commentMaxLength}
          </p>
          {show("note") && <p className="text-sm text-destructive" role="alert">{show("note")}</p>}
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
