export const TOP_GOAL_ROWS = 7;
export function createTopGoalRows() {
  return Array.from({ length: TOP_GOAL_ROWS }, () => ({ code: "", player: "", goals: "" }));
}
