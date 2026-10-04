/** Session-only detection: the first verified snapshot is a silent baseline. */
export class JournalAchievementNoticeTracker {
  private seen: Set<string> | null = null;

  observe(earnedIds: readonly string[] | null): string[] {
    if (earnedIds === null) return []; // Partial statistics cannot establish or change the baseline.
    const ids = [...new Set(earnedIds)];
    if (this.seen === null) {
      this.seen = new Set(ids);
      return [];
    }
    const gained = ids.filter((id) => !this.seen!.has(id));
    for (const id of gained) this.seen.add(id);
    return gained;
  }

  reset() { this.seen = null; }
}
