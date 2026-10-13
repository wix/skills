// Goal progress for one campaign — wire as-is on cards, the campaign page, a home strip. Every
// figure comes from the DTO (the metrics API and the owner's goal): raised of target, the bar at
// Wix's rounded percent (capped visually at 100, the number may exceed it), the donation count,
// and the time left ("3 days left"; hours on the last day; "Ended" once past). Renders nothing
// for a campaign without a goal. Purely presentational — no hooks, so it renders on the server too.
import type { GoalProgress as Goal } from "../../wix/donations/types";

export interface GoalProgressProps {
  goal: Goal | null;
  className?: string;
  /** Hide the donation count (a compact card). */
  compact?: boolean;
}

export function timeLeftLabel(goal: Goal): string {
  if (!goal.endDate) return "";
  if (goal.ended) return "Ended";
  if (goal.lastDay) return goal.hoursLeft === 1 ? "1 hour left" : `${goal.hoursLeft} hours left`;
  return goal.daysLeft === 1 ? "1 day left" : `${goal.daysLeft} days left`;
}

export default function GoalProgress({ goal, className = "", compact = false }: GoalProgressProps) {
  if (!goal) return null;
  const width = Math.max(0, Math.min(100, goal.percent));
  const timeLeft = timeLeftLabel(goal);
  return (
    <div className={className}>
      <div className="flex items-baseline justify-between gap-4">
        <p className="text-foreground">
          {goal.raised && <span className="text-2xl font-bold tracking-tight">{goal.raised}</span>}
          <span className={`text-sm text-muted-foreground ${goal.raised ? "ml-1.5" : ""}`}>
            {goal.raised ? "raised of " : "Goal: "}
            {goal.target}
          </span>
        </p>
        <p className="text-sm font-semibold text-foreground">{goal.percent}%</p>
      </div>
      <div className="mt-2 h-2 w-full overflow-hidden rounded-control bg-secondary" role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={width} aria-label="Progress toward the goal">
        <div className="h-full rounded-control bg-primary transition-[width]" style={{ width: `${width}%` }} />
      </div>
      {(!compact || timeLeft) && (
        <p className="mt-2 flex justify-between text-xs text-muted-foreground">
          {!compact && <span>{goal.donationCount === 1 ? "1 donation" : `${goal.donationCount} donations`}</span>}
          {timeLeft && <span>{timeLeft}</span>}
        </p>
      )}
    </div>
  );
}
