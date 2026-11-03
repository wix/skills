// DOM renderer for a campaign's goal progress (`GoalProgress` from donations-types): raised of
// target, a progress bar at `percent` (capped at 100 for the width), the donation count, and the
// time left. Renders nothing when `goal` is null.
//
// No styles except the bar's width. Class names use one prefix (default "goal"): goal,
// goal-figures, goal-amounts, goal-raised, goal-target, goal-percent, goal-bar, goal-bar-fill,
// goal-meta, goal-count, goal-time-left.
import type { GoalProgress } from "../app/wix/donations/types.js";

export interface GoalProgressOptions {
  /** The first part of every class name (default "goal"). */
  classPrefix?: string;
  /** Hide the donation count (a compact card). */
  compact?: boolean;
}

export function timeLeftLabel(goal: GoalProgress): string {
  if (!goal.endDate) return "";
  if (goal.ended) return "Ended";
  if (goal.lastDay) return goal.hoursLeft === 1 ? "1 hour left" : `${goal.hoursLeft} hours left`;
  return goal.daysLeft === 1 ? "1 day left" : `${goal.daysLeft} days left`;
}

/** Renders the goal block into `root`, replacing its content. With `goal` null the container is left empty. */
export function renderGoalProgress(root: HTMLElement, goal: GoalProgress | null, { classPrefix = "goal", compact = false }: GoalProgressOptions = {}): void {
  root.replaceChildren();
  if (!goal) return;
  const c = (name: string): string => (name ? `${classPrefix}-${name}` : classPrefix);
  const el = (tag: string, className: string, text?: string): HTMLElement => {
    const node = document.createElement(tag);
    node.className = className;
    if (text !== undefined) node.textContent = text;
    return node;
  };
  const width = Math.max(0, Math.min(100, goal.percent));
  const timeLeft = timeLeftLabel(goal);

  const block = el("div", c(""));
  const figures = el("div", c("figures"));
  const amounts = el("p", c("amounts"));
  if (goal.raised) amounts.append(el("span", c("raised"), goal.raised));
  amounts.append(el("span", c("target"), `${goal.raised ? " raised of " : "Goal: "}${goal.target}`));
  figures.append(amounts);
  if (goal.raised) figures.append(el("p", c("percent"), `${goal.percent}%`));
  block.append(figures);

  if (goal.raised) {
    const bar = el("div", c("bar"));
    bar.setAttribute("role", "progressbar");
    bar.setAttribute("aria-valuemin", "0");
    bar.setAttribute("aria-valuemax", "100");
    bar.setAttribute("aria-valuenow", String(width));
    bar.setAttribute("aria-label", "Progress toward the goal");
    const fill = el("div", c("bar-fill"));
    fill.style.width = `${width}%`;
    bar.append(fill);
    block.append(bar);
  }

  if ((!compact && goal.raised) || timeLeft) {
    const meta = el("p", c("meta"));
    if (!compact && goal.raised) meta.append(el("span", c("count"), goal.donationCount === 1 ? "1 donation" : `${goal.donationCount} donations`));
    if (timeLeft) meta.append(el("span", c("time-left"), timeLeft));
    block.append(meta);
  }
  root.append(block);
}
